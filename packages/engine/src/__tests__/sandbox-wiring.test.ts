import { afterEach, describe, expect, it, vi } from "vitest";

import { __runConfiguredCommandForTests } from "../executor.js";
import { __executePostMergeScriptStepForTests } from "../merger.js";
import { RoutineRunner } from "../routine-runner.js";
import { defaultShell } from "../shell-utils.js";
import {
  __resetSandboxBackendForTests,
  __setSandboxBackendForTests,
  type SandboxBackend,
} from "../sandbox/index.js";

describe("sandbox wiring", () => {
  afterEach(() => {
    __resetSandboxBackendForTests();
    vi.restoreAllMocks();
  });

  it("routes executor runConfiguredCommand through sandbox backend", async () => {
    const run = vi.fn().mockResolvedValue({
      stdout: "out",
      stderr: "err",
      exitCode: 23,
      signal: "SIGTERM",
      timedOut: true,
      bufferExceeded: true,
      spawnError: new Error("spawn"),
    });
    const stub: SandboxBackend = {
      capabilities: () => ({ id: "native", supportsNetworkPolicy: false, supportsFilesystemPolicy: false, platform: "any" }),
      prepare: async () => {},
      run,
      dispose: async () => {},
    };
    __setSandboxBackendForTests(stub);

    const result = await __runConfiguredCommandForTests("echo hi", "/tmp", 1200, { A: "1" });

    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith("echo hi", {
      cwd: "/tmp",
      timeoutMs: 1200,
      maxBuffer: 10 * 1024 * 1024,
      encoding: "utf-8",
      env: { A: "1" },
    });
    expect(result).toMatchObject({
      stdout: "out",
      stderr: "err",
      exitCode: 23,
      signal: "SIGTERM",
      timedOut: true,
      bufferExceeded: true,
    });
    expect(result.spawnError).toBeInstanceOf(Error);
  });

  it("routes merger executePostMergeScriptStep through sandbox backend", async () => {
    const run = vi.fn().mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 0,
      signal: null,
      timedOut: false,
      bufferExceeded: false,
    });
    __setSandboxBackendForTests({
      capabilities: () => ({ id: "native", supportsNetworkPolicy: false, supportsFilesystemPolicy: false, platform: "any" }),
      prepare: async () => {},
      run,
      dispose: async () => {},
    });

    const result = await __executePostMergeScriptStepForTests(
      { updateTask: vi.fn() } as any,
      "FN-1",
      { scriptName: "post" } as any,
      "/tmp/worktree",
      { scripts: { post: "echo post" } } as any,
    );

    expect(result.success).toBe(true);
    expect(run).toHaveBeenCalledWith("echo post", {
      cwd: "/tmp/worktree",
      encoding: "utf-8",
      timeoutMs: 120_000,
      maxBuffer: 10 * 1024 * 1024,
    });
  });

  it("routes routine runner command branch through sandbox backend", async () => {
    const run = vi.fn().mockResolvedValue({
      stdout: "routine",
      stderr: "",
      exitCode: 0,
      signal: null,
      timedOut: false,
      bufferExceeded: false,
    });
    __setSandboxBackendForTests({
      capabilities: () => ({ id: "native", supportsNetworkPolicy: false, supportsFilesystemPolicy: false, platform: "any" }),
      prepare: async () => {},
      run,
      dispose: async () => {},
    });

    const runner = new RoutineRunner({
      routineStore: {} as any,
      heartbeatMonitor: {} as any,
      rootDir: "/tmp/root",
    });

    const result = await (runner as any).executeCommand("echo routine", 5000, new Date().toISOString());
    expect(result.success).toBe(true);
    expect(run).toHaveBeenCalledWith("echo routine", {
      cwd: "/tmp/root",
      timeoutMs: 5000,
      maxBuffer: 1024 * 1024,
      shell: defaultShell,
    });
  });
});
