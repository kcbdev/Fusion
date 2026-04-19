// @vitest-environment node

import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChildProcess } from "node:child_process";
import {
  DevServerManager,
  FALLBACK_PORTS,
  MAX_LOG_LINES,
  destroyAllDevServerManagers,
  parseLineForUrl,
} from "../dev-server-manager.js";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

class MockChildProcess extends EventEmitter {
  public readonly stdout = new EventEmitter();
  public readonly stderr = new EventEmitter();
  public readonly kill = vi.fn((signal: NodeJS.Signals = "SIGTERM") => {
    this.killSignals.push(signal);

    if (signal === "SIGTERM" && this.ignoreSigterm) {
      return true;
    }

    queueMicrotask(() => {
      this.emit("exit", 0);
    });

    return true;
  });

  public readonly killSignals: NodeJS.Signals[] = [];

  constructor(
    public readonly pid: number,
    private readonly ignoreSigterm = false,
  ) {
    super();
  }

  emitStdout(text: string): void {
    this.stdout.emit("data", Buffer.from(`${text}\n`, "utf-8"));
  }

  emitStderr(text: string): void {
    this.stderr.emit("data", Buffer.from(`${text}\n`, "utf-8"));
  }

  emitExit(code: number | null): void {
    this.emit("exit", code);
  }

  emitError(message: string): void {
    this.emit("error", new Error(message));
  }
}

const spawnMock = vi.mocked(spawn);

async function waitForCondition(check: () => boolean | Promise<boolean>, timeoutMs = 1500): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for condition");
}

describe("DevServerManager", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "fn-dev-server-manager-"));
    spawnMock.mockReset();
  });

  afterEach(async () => {
    destroyAllDevServerManagers();
    vi.restoreAllMocks();
    vi.useRealTimers();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("handles start lifecycle transitions and captures logs", async () => {
    const child = new MockChildProcess(12345);
    spawnMock.mockReturnValue(child as unknown as ChildProcess);

    const manager = new DevServerManager(tempDir);
    const startState = await manager.start("echo hello", "test", tempDir);

    expect(startState.status).toBe("starting");
    expect(startState.command).toBe("echo hello");
    expect(startState.scriptName).toBe("test");
    expect(startState.cwd).toBe(tempDir);
    expect(startState.pid).toBe(12345);
    expect(typeof startState.startedAt).toBe("string");

    child.emitStdout("hello from stdout");
    expect(manager.getState().status).toBe("running");
    expect(manager.getLogs()).toContain("hello from stdout");

    child.emitExit(0);
    await waitForCondition(() => manager.getState().status === "stopped");
    expect(manager.getState().exitCode).toBe(0);
  });

  it("throws when start is called while already active", async () => {
    const child = new MockChildProcess(12121);
    spawnMock.mockReturnValue(child as unknown as ChildProcess);

    const manager = new DevServerManager(tempDir);
    await manager.start("npm run dev", "dev", tempDir);
    child.emitStdout("running");

    await expect(manager.start("npm run dev", "dev", tempDir)).rejects.toThrow("Dev server is already running");
  });

  it("stops a running process with SIGTERM", async () => {
    const child = new MockChildProcess(23456);
    spawnMock.mockReturnValue(child as unknown as ChildProcess);

    const manager = new DevServerManager(tempDir);
    await manager.start("node server.js", "dev", tempDir);
    child.emitStdout("booting");

    const state = await manager.stop();
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(state.status).toBe("stopped");

    await waitForCondition(() => manager.getState().status === "stopped");
  });

  it("sends SIGKILL fallback when process ignores SIGTERM", async () => {
    vi.useFakeTimers();

    const child = new MockChildProcess(34567, true);
    spawnMock.mockReturnValue(child as unknown as ChildProcess);

    const manager = new DevServerManager(tempDir);
    await manager.start("node stubborn.js", "dev", tempDir);
    child.emitStdout("running");

    await manager.stop();
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    await vi.advanceTimersByTimeAsync(5_100);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("restarts using stored command/scriptName/cwd", async () => {
    const first = new MockChildProcess(45678);
    const second = new MockChildProcess(56789);
    spawnMock
      .mockReturnValueOnce(first as unknown as ChildProcess)
      .mockReturnValueOnce(second as unknown as ChildProcess);

    const manager = new DevServerManager(tempDir);
    await manager.start("npm run dev", "dev", tempDir);
    first.emitStdout("ready");

    const restarted = await manager.restart();
    expect(first.kill).toHaveBeenCalledWith("SIGTERM");
    expect(spawnMock).toHaveBeenNthCalledWith(
      2,
      "npm run dev",
      [],
      expect.objectContaining({ cwd: tempDir, shell: true }),
    );
    expect(restarted.pid).toBe(56789);
  });

  it("throws when restart is called before initial start", async () => {
    const manager = new DevServerManager(tempDir);
    await expect(manager.restart()).rejects.toThrow("Cannot restart dev server before it has been started once");
  });

  it("returns all server states", () => {
    const manager = new DevServerManager(tempDir);
    const states = manager.getAllStates();
    expect(states).toHaveLength(1);
    expect(states[0]?.id).toBe("default");
  });

  it("parses known URL log patterns", () => {
    expect(parseLineForUrl("  > Local: http://localhost:5173/")).toEqual({
      url: "http://localhost:5173",
      port: 5173,
    });
    expect(parseLineForUrl("ready on http://localhost:3000")).toEqual({
      url: "http://localhost:3000",
      port: 3000,
    });
    expect(parseLineForUrl("Local: http://localhost:6006")).toEqual({
      url: "http://localhost:6006",
      port: 6006,
    });
    expect(parseLineForUrl("http://0.0.0.0:8080")).toEqual({
      url: "http://localhost:8080",
      port: 8080,
    });
    expect(parseLineForUrl("listening on 127.0.0.1:4173")).toEqual({
      url: "http://localhost:4173",
      port: 4173,
    });
    expect(parseLineForUrl("no url here")).toBeNull();
  });

  it("detects URL from output and emits url-detected event", async () => {
    const child = new MockChildProcess(67890);
    spawnMock.mockReturnValue(child as unknown as ChildProcess);

    const manager = new DevServerManager(tempDir);
    const onDetected = vi.fn();
    manager.on("url-detected", onDetected);

    await manager.start("npm run dev", "dev", tempDir);
    child.emitStdout("Local: http://localhost:5173");

    await waitForCondition(() => manager.getState().previewUrl === "http://localhost:5173");
    expect(manager.getState().detectedPort).toBe(5173);
    expect(onDetected).toHaveBeenCalledWith({
      serverId: "default",
      url: "http://localhost:5173",
      port: 5173,
    });
  });

  it("schedules fallback probing after 10 seconds when no URL is detected", async () => {
    vi.useFakeTimers();

    const child = new MockChildProcess(78901);
    spawnMock.mockReturnValue(child as unknown as ChildProcess);

    const manager = new DevServerManager(tempDir);
    const probeSpy = vi.spyOn(manager as unknown as { probeFallbackPorts: () => void }, "probeFallbackPorts");

    await manager.start("npm run dev", "dev", tempDir);
    child.emitStdout("server booted");

    await vi.advanceTimersByTimeAsync(10_100);
    expect(probeSpy).toHaveBeenCalled();
    expect(FALLBACK_PORTS.includes(4040 as never)).toBe(false);
  });

  it("detects a running server through fallback port probing", async () => {
    const child = new MockChildProcess(78902);
    spawnMock.mockReturnValue(child as unknown as ChildProcess);

    const server = createServer((_req, res) => {
      res.statusCode = 200;
      res.end("ok");
    });
    await new Promise<void>((resolve) => server.listen(3000, () => resolve()));

    try {
      const manager = new DevServerManager(tempDir);
      await manager.start("npm run dev", "dev", tempDir);
      child.emitStdout("server booted");

      (manager as unknown as { probeFallbackPorts: () => void }).probeFallbackPorts();
      await waitForCondition(() => manager.getState().detectedPort === 3000, 3_000);

      expect(manager.getState().previewUrl).toBe("http://localhost:3000");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  });

  it("persists state and reconnects when existing PID is alive", async () => {
    const child = new MockChildProcess(89012);
    spawnMock.mockReturnValue(child as unknown as ChildProcess);

    const manager = new DevServerManager(tempDir);
    await manager.start("npm run dev", "dev", tempDir);

    const stateFile = path.join(tempDir, ".fusion", "dev-server.json");
    await waitForCondition(async () => {
      try {
        await readFile(stateFile, "utf-8");
        return true;
      } catch {
        return false;
      }
    });

    const killSpy = vi.spyOn(process, "kill").mockImplementation(((pid: number, signal?: number | NodeJS.Signals) => {
      if (signal === 0 && pid === 89012) {
        return true;
      }
      throw Object.assign(new Error("ESRCH"), { code: "ESRCH" });
    }) as typeof process.kill);

    const reloaded = new DevServerManager(tempDir);
    await reloaded.stop();

    expect(reloaded.getState().status).toBe("running");
    expect(reloaded.getState().pid).toBe(89012);

    killSpy.mockRestore();
  });

  it("marks persisted dead PID as stopped", async () => {
    const stateFile = path.join(tempDir, ".fusion", "dev-server.json");
    await mkdir(path.dirname(stateFile), { recursive: true });
    await writeFile(
      stateFile,
      JSON.stringify({
        id: "default",
        name: "default",
        command: "npm run dev",
        scriptName: "dev",
        cwd: tempDir,
        pid: 999999,
      }),
      "utf-8",
    );

    const killSpy = vi.spyOn(process, "kill").mockImplementation(((pid: number, signal?: number | NodeJS.Signals) => {
      if (signal === 0 && pid === 999999) {
        throw Object.assign(new Error("ESRCH"), { code: "ESRCH" });
      }
      return true;
    }) as typeof process.kill);

    const manager = new DevServerManager(tempDir);
    await manager.stop();

    expect(manager.getState().status).toBe("stopped");
    expect(manager.getState().pid).toBeUndefined();

    killSpy.mockRestore();
  });

  it("supports manual preview URL override and reset", async () => {
    const child = new MockChildProcess(90123);
    spawnMock.mockReturnValue(child as unknown as ChildProcess);

    const manager = new DevServerManager(tempDir);
    await manager.start("npm run dev", "dev", tempDir);
    child.emitStdout("ready on http://localhost:5173");

    await waitForCondition(() => manager.getState().detectedPort === 5173);

    manager.setManualPreviewUrl("http://example.com:9999");
    expect(manager.getState().manualPreviewUrl).toBe("http://example.com:9999");
    expect(manager.getState().previewUrl).toBe("http://example.com:9999");

    manager.setManualPreviewUrl(null);
    expect(manager.getState().manualPreviewUrl).toBeUndefined();
    expect(manager.getState().previewUrl).toBe("http://localhost:5173");
  });

  it("keeps logs in a 500-line ring buffer", async () => {
    const child = new MockChildProcess(11223);
    spawnMock.mockReturnValue(child as unknown as ChildProcess);

    const manager = new DevServerManager(tempDir);
    await manager.start("npm run dev", "dev", tempDir);

    for (let index = 0; index < MAX_LOG_LINES + 25; index += 1) {
      child.emitStdout(`line-${index}`);
    }

    const logs = manager.getLogs();
    expect(logs).toHaveLength(MAX_LOG_LINES);
    expect(logs[0]).toBe("line-25");
    expect(logs.at(-1)).toBe(`line-${MAX_LOG_LINES + 24}`);
    expect(manager.getLogs(10)).toHaveLength(10);
  });

  it("destroy() kills running processes and clears internal timers/maps", async () => {
    vi.useFakeTimers();

    const child = new MockChildProcess(22334, true);
    spawnMock.mockReturnValue(child as unknown as ChildProcess);

    const manager = new DevServerManager(tempDir);
    await manager.start("npm run dev", "dev", tempDir);
    child.emitStdout("running");

    manager.destroy();

    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect((manager as unknown as { processes: Map<string, ChildProcess> }).processes.size).toBe(0);
    expect((manager as unknown as { servers: Map<string, unknown> }).servers.size).toBe(0);

    await vi.advanceTimersByTimeAsync(5_100);
    expect(child.kill).toHaveBeenCalledTimes(1);
  });
});
