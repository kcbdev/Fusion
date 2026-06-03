import { describe, it, expect, afterEach, vi } from "vitest";
import { fileURLToPath } from "node:url";
import {
  connect,
  newAcpSession,
  promptAcpSession,
  cancelAcpSession,
  loadAcpSession,
  createBridgingClientHandler,
  type AcpConnection,
} from "../provider.js";
import { buildPromptBlocks } from "../prompt-builder.js";
import { killAllProcesses } from "../process-manager.js";

const FIXTURE = fileURLToPath(new URL("./fixtures/echo-agent.mjs", import.meta.url));

afterEach(() => {
  killAllProcesses();
});

function baseOpts(extraEnv: Record<string, string> = {}) {
  return {
    binaryPath: process.execPath,
    args: [FIXTURE],
    cwd: process.cwd(),
    env: extraEnv as NodeJS.ProcessEnv,
    advertiseFs: { read: false, write: false },
    initializeTimeoutMs: 10_000,
  };
}

async function open(extraEnv: Record<string, string> = {}): Promise<AcpConnection> {
  return connect(baseOpts(extraEnv));
}

describe("session driving helpers", () => {
  it("newAcpSession opens a session and returns a sessionId", async () => {
    const conn = await open();
    try {
      const { sessionId } = await newAcpSession(conn, { cwd: process.cwd() });
      expect(typeof sessionId).toBe("string");
      expect(sessionId.length).toBeGreaterThan(0);
    } finally {
      conn.dispose();
    }
  });

  it("promptAcpSession resolves with end_turn for a normal turn", async () => {
    const conn = await open();
    try {
      const { sessionId } = await newAcpSession(conn, { cwd: process.cwd() });
      const stopReason = await promptAcpSession(conn, sessionId, buildPromptBlocks("hello"));
      expect(stopReason).toBe("end_turn");
    } finally {
      conn.dispose();
    }
  });

  it("cancelAcpSession releases a mid-turn prompt with the cancelled stop reason", async () => {
    const conn = await open({ ACP_FIXTURE_HANG_PROMPT: "1" });
    try {
      const { sessionId } = await newAcpSession(conn, { cwd: process.cwd() });
      const promptPromise = promptAcpSession(conn, sessionId, buildPromptBlocks("hello"));
      // Give the turn a tick to register the hang before cancelling.
      await new Promise((r) => setImmediate(r));
      await cancelAcpSession(conn, sessionId);
      const stopReason = await promptPromise;
      expect(stopReason).toBe("cancelled");
    } finally {
      conn.dispose();
    }
  });

  it("cancelAcpSession swallows errors (fire-and-forget)", async () => {
    const conn = await open();
    try {
      const { sessionId } = await newAcpSession(conn, { cwd: process.cwd() });
      conn.dispose(); // kill the child so cancel cannot round-trip
      await expect(cancelAcpSession(conn, sessionId)).resolves.toBeUndefined();
    } finally {
      conn.dispose();
    }
  });

  it("loadAcpSession uses session/load when the agent advertises loadSession", async () => {
    const conn = await open({ ACP_FIXTURE_LOAD_SESSION: "1" });
    try {
      expect(conn.agentCapabilities).toMatchObject({ loadSession: true });
      const result = await loadAcpSession(conn, {
        sessionId: "prior-session-id",
        cwd: process.cwd(),
      });
      // session/load echoes back the requested id (no fresh id minted).
      expect(result.sessionId).toBe("prior-session-id");
    } finally {
      conn.dispose();
    }
  });

  it("bridging client handler surfaces a rich prompt turn's updates onto callbacks (U4)", async () => {
    const onText = vi.fn<(t: string) => void>();
    const onThinking = vi.fn<(t: string) => void>();
    const onToolStart = vi.fn<(name: string, args?: unknown) => void>();
    const onToolEnd = vi.fn<(name: string, isError: boolean, result?: unknown) => void>();

    const conn = await connect({
      ...baseOpts({ ACP_FIXTURE_RICH_PROMPT: "1" }),
      clientHandler: createBridgingClientHandler({ onText, onThinking, onToolStart, onToolEnd }).handler,
    });
    try {
      const { sessionId } = await newAcpSession(conn, { cwd: process.cwd() });
      const stopReason = await promptAcpSession(conn, sessionId, buildPromptBlocks("go"));
      expect(stopReason).toBe("end_turn");

      // The SDK prompt promise resolves only after all updates are delivered.
      expect(onText.mock.calls.map((c) => c[0]).join("")).toBe("Working on it.");
      expect(onThinking).toHaveBeenCalledWith("Let me think about this.");
      expect(onToolStart).toHaveBeenCalledWith("Run tests", { command: "pnpm test" });
      expect(onToolEnd).toHaveBeenCalledWith("Run tests", false, { exitCode: 0 });
      // The plan surfaces as a thinking line.
      expect(onThinking.mock.calls.some((c) => String(c[0]).includes("Fix the bug"))).toBe(true);
    } finally {
      conn.dispose();
    }
  });

  it("loadAcpSession falls back to newSession when loadSession is not advertised", async () => {
    const conn = await open(); // loadSession defaults false
    try {
      expect(conn.agentCapabilities).toMatchObject({ loadSession: false });
      const result = await loadAcpSession(conn, {
        sessionId: "prior-session-id",
        cwd: process.cwd(),
      });
      // Fresh session: a new id is minted, not the prior one.
      expect(result.sessionId).not.toBe("prior-session-id");
      expect(result.sessionId.length).toBeGreaterThan(0);
    } finally {
      conn.dispose();
    }
  });
});
