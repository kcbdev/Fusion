/**
 * ACP transport for the pi-claude-cli provider (U11 — Route A).
 *
 * `streamViaAcp` is the drop-in alternative to `streamViaCli` that drives Claude
 * through the `claude-code-cli-acp` bridge over the Agent Client Protocol instead
 * of `claude -p`. It returns the SAME `AssistantMessageEventStream` shape, so the
 * provider's `streamSimple` can dispatch to either transport behind a kill-switch.
 *
 * Design (see plan U11):
 * - Full-history prompt EVERY turn (`buildPrompt`) — the ACP path has no Claude
 *   `--resume`, so we never send the latest-turn-only `buildResumePrompt` (R13).
 * - MCP tool SCHEMAS are forwarded on `session/new` so Claude knows the Fusion
 *   tools and emits correct `tool_use` calls; we DO NOT let the bridge execute
 *   them. On the first tool call we break early (cancel the turn) and surface the
 *   call to pi, which runs the tool itself — mirroring the `-p` break-early
 *   pattern (the schema-only MCP server never reaches `tools/call`).
 * - Translation reuses the tested `createEventBridge` by synthesizing Claude
 *   stream events from ACP `session/update`s, so pi event sequencing, tool-name
 *   mapping and arg translation are shared with the `-p` path.
 *
 * Auth: the bridge spawns the real `claude`, which authenticates from the host
 * login/keychain session (R17). The bridge binary path is injected by the caller
 * (engine seam, KTD10) — this module never reaches into the ACP plugin.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { Readable, Writable } from "node:stream";
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
} from "@agentclientprotocol/sdk";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { Api, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { buildPrompt, buildSystemPrompt, type PiContext } from "./prompt-builder.js";
import { createEventBridge } from "./event-bridge.js";
import type { ClaudeApiEvent } from "./types.js";

/** A stdio MCP server forwarded on `session/new` (schema-only — never executed here). */
export interface AcpMcpServerSpec {
  name: string;
  command: string;
  args: string[];
  env: { name: string; value: string }[];
}

/** Options for the ACP transport: pi's stream options plus ACP wiring. */
export type StreamViaAcpOptions = SimpleStreamOptions & {
  cwd?: string;
  /** Absolute path to the `claude-code-cli-acp` bridge binary (injected by the engine seam). */
  bridgePath: string;
  /** MCP servers (tool schemas) forwarded so Claude emits correct tool calls. */
  mcpServers?: AcpMcpServerSpec[];
  /** Env allow-list forwarded to the bridge (HOME/PATH …); never inherited process.env. */
  bridgeEnv?: NodeJS.ProcessEnv;
};

const INITIALIZE_TIMEOUT_MS = 30_000;

function flattenPromptText(prompt: string | { type: string; text?: string }[]): string {
  if (typeof prompt === "string") return prompt;
  return prompt
    .map((b) => (b.type === "text" && typeof b.text === "string" ? b.text : ""))
    .join("");
}

/**
 * Stream a Claude response via the ACP bridge as an `AssistantMessageEventStream`.
 * Mirrors `streamViaCli`'s contract (start → deltas → done; break-early on tools).
 */
export function streamViaAcp(
  model: Model<Api>,
  context: PiContext,
  options: StreamViaAcpOptions,
): AssistantMessageEventStream {
  // @ts-expect-error — pi-ai exports AssistantMessageEventStream as a type; the
  // constructor exists at runtime (same workaround as streamViaCli).
  const stream = new AssistantMessageEventStream();
  const bridge = createEventBridge(stream, model);

  (async () => {
    let child: ChildProcess | undefined;
    let ended = false;
    // Claude content-block index synthesis: one open text/thinking block at a time.
    let blockIndex = -1;
    let openKind: "text" | "thinking" | null = null;
    let sawToolCall = false;

    const finish = (reason: "stop" | "tool_use") => {
      if (ended) return;
      ended = true;
      if (openKind !== null) bridge.handleEvent({ type: "content_block_stop", index: blockIndex } as ClaudeApiEvent);
      bridge.handleEvent({ type: "message_delta", delta: { stop_reason: reason === "tool_use" ? "tool_use" : "end_turn" } } as ClaudeApiEvent);
      stream.push({ type: "done", reason: reason === "tool_use" ? "toolUse" : "stop", message: bridge.getOutput() });
      stream.end();
      try { child?.kill("SIGKILL"); } catch { /* registry SIGKILL is authoritative */ }
    };

    const failWith = (msg: string) => {
      if (ended) return;
      ended = true;
      const output = bridge.getOutput();
      stream.push({
        type: "done",
        reason: "stop",
        message: {
          ...output,
          content: output.content?.length ? output.content : [{ type: "text" as const, text: `Error: ${msg}` }],
          stopReason: "stop" as const,
        },
      });
      stream.end();
      try { child?.kill("SIGKILL"); } catch { /* noop */ }
    };

    // Ensure a text/thinking block is open, closing any block of the other kind first.
    const openBlock = (kind: "text" | "thinking") => {
      if (openKind === kind) return;
      if (openKind !== null) bridge.handleEvent({ type: "content_block_stop", index: blockIndex } as ClaudeApiEvent);
      blockIndex += 1;
      openKind = kind;
      bridge.handleEvent({
        type: "content_block_start",
        index: blockIndex,
        content_block: { type: kind },
      } as ClaudeApiEvent);
    };

    const clientHandler = {
      async sessionUpdate(params: { update?: Record<string, unknown> } & Record<string, unknown>) {
        if (ended) return;
        const u = (params.update ?? params) as Record<string, unknown>;
        const kind = u.sessionUpdate as string;
        const content = u.content as { type?: string; text?: string } | undefined;

        if (kind === "agent_message_chunk" && content?.type === "text" && content.text) {
          openBlock("text");
          bridge.handleEvent({ type: "content_block_delta", index: blockIndex, delta: { type: "text_delta", text: content.text } } as ClaudeApiEvent);
        } else if (kind === "agent_thought_chunk" && content?.text) {
          openBlock("thinking");
          bridge.handleEvent({ type: "content_block_delta", index: blockIndex, delta: { type: "thinking_delta", thinking: content.text } } as ClaudeApiEvent);
        } else if (kind === "tool_call") {
          // Break-early: surface the tool call to pi, do NOT let the bridge execute it.
          const meta = (u._meta as { claudeCode?: { toolName?: string } } | undefined)?.claudeCode;
          const claudeName = (meta?.toolName as string) ?? (u.title as string) ?? "";
          const id = (u.toolCallId as string) ?? `acp_${blockIndex + 1}`;
          if (openKind !== null) { bridge.handleEvent({ type: "content_block_stop", index: blockIndex } as ClaudeApiEvent); openKind = null; }
          blockIndex += 1;
          bridge.handleEvent({ type: "content_block_start", index: blockIndex, content_block: { type: "tool_use", name: claudeName, id } } as ClaudeApiEvent);
          const rawInput = u.rawInput ?? u.input ?? {};
          bridge.handleEvent({ type: "content_block_delta", index: blockIndex, delta: { type: "input_json_delta", partial_json: JSON.stringify(rawInput) } } as ClaudeApiEvent);
          bridge.handleEvent({ type: "content_block_stop", index: blockIndex } as ClaudeApiEvent);
          sawToolCall = true;
          finish("tool_use");
        }
      },
      async requestPermission() {
        // We break early before execution, so this should not fire. Reject to be safe.
        return { outcome: { outcome: "cancelled" as const } };
      },
    };

    try {
      const env = options.bridgeEnv ?? { HOME: process.env.HOME, PATH: process.env.PATH };
      child = spawn(options.bridgePath, [], { stdio: ["pipe", "pipe", "pipe"], cwd: options.cwd ?? process.cwd(), env });
      child.on("error", (e) => failWith(`ACP bridge spawn failed: ${e.message}`));
      if (options.signal) options.signal.addEventListener("abort", () => { try { child?.kill("SIGKILL"); } catch { /* noop */ } failWith("aborted"); }, { once: true });

      const acpStream = ndJsonStream(
        Writable.toWeb(child.stdin!) as unknown as WritableStream<Uint8Array>,
        Readable.toWeb(child.stdout!) as unknown as ReadableStream<Uint8Array>,
      );
      const conn = new ClientSideConnection(() => clientHandler, acpStream);

      const init = await Promise.race([
        conn.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } } }),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("ACP initialize timeout")), INITIALIZE_TIMEOUT_MS)),
      ]);
      if (init.protocolVersion !== PROTOCOL_VERSION) { failWith(`incompatible ACP protocol ${init.protocolVersion}`); return; }

      const opened = await conn.newSession({ cwd: options.cwd ?? process.cwd(), mcpServers: options.mcpServers ?? [] });

      const cwd = options.cwd ?? process.cwd();
      const promptText = flattenPromptText(buildPrompt(context));
      const systemPrompt = buildSystemPrompt(context, cwd);
      const blocks = [
        ...(systemPrompt ? [{ type: "text" as const, text: `${systemPrompt}\n\n` }] : []),
        { type: "text" as const, text: promptText },
      ];

      await conn.prompt({ sessionId: opened.sessionId, prompt: blocks });
      // Resolved without a tool call → normal end of turn.
      if (!sawToolCall) finish("stop");
    } catch (err) {
      failWith(err instanceof Error ? err.message : String(err));
    }
  })();

  return stream;
}
