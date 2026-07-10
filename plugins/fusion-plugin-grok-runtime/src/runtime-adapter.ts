import { forceKillGrokStream, spawnGrokStream, type GrokStreamProcess, type SpawnGrokStreamOptions } from "./cli-stream.js";
import { parseJsonOutput, parseLine } from "./stream-parser.js";
import type { AgentRuntime, AgentRuntimeOptions, AgentSession, AgentSessionResult, GrokSession } from "./types.js";

/*
FNXC:GrokCli 2026-07-10-12:52:
FN-7796: the production binary is xAI's Grok Build TUI. Its `--output-format streaming-json` path intermittently emits only `thought` events and then `stopReason:"Cancelled"` with no `text`, so the adapter now consumes the reliable `--output-format json` single object on subprocess close. Bridge object `text` to `onText`, object `thought` to `onThinking`, record `sessionId`, and make non-`EndTurn` empty-text terminals diagnosable instead of silent.

FNXC:GrokCliRouting 2026-07-10-10:54:
FN-7753's auto-derived `grok` runtime routing from a `grok-cli/*` model selection still preserves the concrete model. Normalize provider-qualified ids (`grok-cli/<id>` or `grok/<id>`) at session creation/prompt time and pass only the concrete id to `grok -m`; the no-model Runtime-mode path keeps the historical `grok/default` session fallback and omits `-m`.
*/

/**
 * Cold-start ceiling: if `grok -p --output-format json` produces no stdout
 * bytes within this window, treat it as a hung/failed subprocess and resolve
 * (never reject — mirrors the Droid adapter's resolve-on-error lifecycle so pi
 * always gets a well-formed, if diagnostic, result instead of an unhandled rejection).
 */
const FIRST_OUTPUT_TIMEOUT_MS = 60_000;

/**
 * Inactivity safety net: kill the subprocess if no stdout bytes arrive for
 * this long after the first chunk. Generous ceiling mirroring the Droid
 * adapter's rationale — the caller (Fusion's stuck-task detection / abort
 * signal) is the authoritative "this session is stuck" source; this is a
 * last-resort guard for a catastrophically hung `grok` process.
 */
const INACTIVITY_TIMEOUT_MS = 30 * 60_000;

function normalizeGrokCliModel(model: string | undefined): string | undefined {
  const normalized = model?.trim();
  if (!normalized) return undefined;
  for (const prefix of ["grok-cli/", "grok/"]) {
    if (normalized.startsWith(prefix)) {
      const stripped = normalized.slice(prefix.length).trim();
      return stripped.length > 0 ? stripped : undefined;
    }
  }
  return normalized;
}

function modelForCli(model: string | undefined): string | undefined {
  const normalized = normalizeGrokCliModel(model);
  return normalized && normalized !== "default" ? normalized : undefined;
}

function compactDiagnostic(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function formatCloseDiagnostic(code: number | null, signal: NodeJS.Signals | null, stderr: string): string {
  const detail = compactDiagnostic(stderr);
  const exitDetail = code === null ? `signal ${signal ?? "unknown"}` : `code ${code}`;
  return detail ? `Grok CLI failed (${exitDetail}): ${detail}` : `Grok CLI failed with ${exitDetail} and no stderr output.`;
}

function formatNoJsonDiagnostic(firstStdoutChunk: string | undefined): string {
  const firstChunk = firstStdoutChunk ? compactDiagnostic(firstStdoutChunk) : "";
  if (firstChunk) {
    return `Grok CLI produced stdout but no parseable JSON response for a headless prompt; first output: ${firstChunk}`;
  }
  return "Grok CLI produced no JSON output for a headless prompt; this usually means the binary on PATH is not xAI's supported Grok Build TUI headless implementation, did not recognize -p/--output-format json, or exited interactive mode immediately after stdin EOF.";
}

function formatTerminalNoTextDiagnostic(stopReason: string): string {
  return `Grok CLI ended with stopReason ${stopReason} and produced no assistant text.`;
}

function appendMessage(session: GrokSession, role: "user" | "assistant", content: string): void {
  session.state.messages.push({ role, content });
}

interface ParsedPromptOutput {
  text: string;
  thought?: string;
  stopReason?: string;
  sessionId?: string;
  parsed: boolean;
}

function parsePromptOutput(stdout: string): ParsedPromptOutput {
  const json = parseJsonOutput(stdout);
  if (json) {
    return {
      text: json.text ?? "",
      thought: json.thought,
      stopReason: json.stopReason,
      sessionId: json.sessionId,
      parsed: true,
    };
  }

  let text = "";
  let thought = "";
  let stopReason: string | undefined;
  let sessionId: string | undefined;
  let parsed = false;
  for (const line of stdout.split(/\r?\n/)) {
    const event = parseLine(line);
    if (!event) continue;
    parsed = true;
    if (event.type === "text") {
      text += event.data;
    } else if (event.type === "thought") {
      thought += event.data;
    } else {
      stopReason = event.stopReason;
      sessionId = event.sessionId;
    }
  }

  return { text, thought: thought || undefined, stopReason, sessionId, parsed };
}

export interface GrokRuntimeAdapterOptions {
  /** Binary name/path to invoke. Defaults to "grok" (PATH resolution). */
  binary?: string;
  /** Injectable spawn seam for tests — defaults to the real `spawnGrokStream`. */
  spawn?: (binary: string, prompt: string, options?: SpawnGrokStreamOptions) => GrokStreamProcess;
}

export class GrokRuntimeAdapter implements AgentRuntime {
  readonly id = "grok";
  readonly name = "Grok Runtime";
  private readonly binary: string;
  private readonly spawnFn: (binary: string, prompt: string, options?: SpawnGrokStreamOptions) => GrokStreamProcess;

  constructor(options?: GrokRuntimeAdapterOptions) {
    this.binary = options?.binary ?? "grok";
    this.spawnFn = options?.spawn ?? spawnGrokStream;
  }

  async createSession(
    options: {
      defaultModelId?: string;
      systemPrompt?: string;
      onText?: (text: string) => void;
      onThinking?: (text: string) => void;
      onToolStart?: (toolName: string, args?: unknown) => void;
      onToolEnd?: (toolName: string, isError: boolean, result?: unknown) => void;
    } = {},
  ): Promise<AgentSessionResult> {
    const model = normalizeGrokCliModel(options.defaultModelId) ?? "grok/default";
    const messages: unknown[] = [];
    const session: GrokSession = {
      model,
      systemPrompt: options.systemPrompt,
      messages,
      state: { messages },
      sessionId: undefined,
      lastModelDescription: `grok/${model}`,
      callbacks: {
        onText: options.onText,
        onThinking: options.onThinking,
        onToolStart: options.onToolStart,
        onToolEnd: options.onToolEnd,
      },
    };
    return { session, sessionFile: undefined };
  }

  async promptWithFallback(session: AgentSession, prompt: string, options?: AgentRuntimeOptions): Promise<void> {
    const grokSession = session as GrokSession;
    const cwd = options?.cwd;
    const signal = options?.signal;
    appendMessage(grokSession, "user", prompt);

    return new Promise<void>((resolve) => {
      let proc: GrokStreamProcess;
      try {
        proc = this.spawnFn(this.binary, prompt, { cwd, model: modelForCli(grokSession.model), signal });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const diagnostic = compactDiagnostic(`Grok CLI spawn failed: ${message}`);
        grokSession.state.errorMessage = diagnostic;
        grokSession.callbacks.onText?.(diagnostic);
        appendMessage(grokSession, "assistant", diagnostic);
        resolve();
        return;
      }

      let settled = false;
      let firstOutputReceived = false;
      let firstStdoutChunk: string | undefined;
      let assistantText = "";
      let diagnosticEmitted = false;
      let stderr = "";
      let stdout = "";
      let firstOutputTimer: NodeJS.Timeout | undefined;
      let inactivityTimer: NodeJS.Timeout | undefined;

      const setErrorMessage = (message: string) => {
        if (message.trim().length === 0) return;
        grokSession.state.errorMessage = message;
      };

      const emitDiagnosticText = (message: string | undefined) => {
        const diagnostic = message?.trim();
        if (!diagnostic || assistantText || diagnosticEmitted) return;
        diagnosticEmitted = true;
        grokSession.callbacks.onText?.(diagnostic);
        appendMessage(grokSession, "assistant", diagnostic);
      };

      const emitParsedOutput = (parsed: ParsedPromptOutput) => {
        if (parsed.thought) {
          grokSession.callbacks.onThinking?.(parsed.thought);
        }
        if (parsed.sessionId) {
          grokSession.sessionId = parsed.sessionId;
        }
        if (parsed.text.length > 0) {
          assistantText += parsed.text;
          grokSession.callbacks.onText?.(parsed.text);
          return;
        }
        if (parsed.stopReason && parsed.stopReason !== "EndTurn") {
          setErrorMessage(formatTerminalNoTextDiagnostic(parsed.stopReason));
        }
      };

      const finish = () => {
        if (settled) return;
        settled = true;
        if (firstOutputTimer) clearTimeout(firstOutputTimer);
        if (inactivityTimer) clearTimeout(inactivityTimer);
        if (assistantText) {
          appendMessage(grokSession, "assistant", assistantText);
        } else {
          emitDiagnosticText(grokSession.state.errorMessage);
        }
        resolve();
      };

      const resetInactivityTimer = () => {
        if (inactivityTimer) clearTimeout(inactivityTimer);
        inactivityTimer = setTimeout(() => {
          setErrorMessage(
            `Grok CLI stopped producing stdout for ${INACTIVITY_TIMEOUT_MS}ms during a headless prompt; the process was killed.`,
          );
          forceKillGrokStream(proc);
          finish();
        }, INACTIVITY_TIMEOUT_MS);
      };

      firstOutputTimer = setTimeout(() => {
        if (firstOutputReceived) return;
        setErrorMessage(
          `Grok CLI produced no stdout within ${FIRST_OUTPUT_TIMEOUT_MS}ms for a headless prompt; the process was killed.`,
        );
        forceKillGrokStream(proc);
        finish();
      }, FIRST_OUTPUT_TIMEOUT_MS);

      proc.stdout?.on("data", (chunk: Buffer | string) => {
        const text = chunk.toString();
        if (!firstOutputReceived) {
          firstOutputReceived = true;
          firstStdoutChunk = text;
          if (firstOutputTimer) clearTimeout(firstOutputTimer);
        }
        stdout += text;
        resetInactivityTimer();
      });

      proc.stderr?.on("data", (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });

      proc.on("error", (err) => {
        const message = err instanceof Error ? err.message : String(err);
        if (!assistantText) {
          setErrorMessage(compactDiagnostic(`Grok CLI process error: ${message}`));
        }
        finish();
      });

      proc.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
        const parsed = parsePromptOutput(stdout);
        if (parsed.parsed) {
          emitParsedOutput(parsed);
        }

        const failed = typeof code === "number" ? code !== 0 : Boolean(signal);
        if (!assistantText && failed) {
          setErrorMessage(formatCloseDiagnostic(typeof code === "number" ? code : null, signal, stderr));
        } else if (!assistantText && !parsed.parsed && typeof code === "number" && code === 0) {
          setErrorMessage(formatNoJsonDiagnostic(firstStdoutChunk));
        }
        finish();
      });
    });
  }

  describeModel(session: AgentSession): string {
    const grokSession = session as GrokSession;
    return grokSession.lastModelDescription || `grok/${grokSession.model ?? "default"}`;
  }
}
