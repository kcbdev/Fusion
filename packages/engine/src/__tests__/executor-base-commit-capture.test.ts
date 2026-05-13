import { beforeEach, describe, expect, it, vi } from "vitest";
import "./executor-test-helpers.js";
import { TaskExecutor } from "../executor.js";
import { executorLog } from "../logger.js";
import type { Task } from "@fusion/core";
import { createMockStore, mockedExec, mockedExecSync, resetExecutorMocks } from "./executor-test-helpers.js";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "FN-4383",
    title: "Test",
    description: "Test",
    column: "in-progress",
    dependencies: [],
    steps: [],
    currentStep: 0,
    log: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as Task;
}

describe("captureBaseCommitSha", () => {
  beforeEach(() => {
    resetExecutorMocks();
  });

  it("captures merge-base for fresh worktree", async () => {
    mockedExec.mockImplementation((cmd: any, _opts: any, cb: any) => cb(null, cmd.includes("merge-base") ? "abc1234\n" : ""));
    const store = createMockStore();
    const executor = new TaskExecutor(store, "/tmp/test");
    const audit = { git: vi.fn().mockResolvedValue(undefined) };

    await (executor as any).captureBaseCommitSha(makeTask(), "/tmp/test/.worktrees/fn-4383", audit);

    expect(store.updateTask).toHaveBeenCalledWith("FN-4383", { baseCommitSha: "abc1234" });
    expect(audit.git).toHaveBeenCalledWith(expect.objectContaining({ metadata: { purpose: "base", preserved: false } }));
  });

  it("preserves existing valid baseCommitSha across sessions", async () => {
    mockedExecSync.mockReturnValue("");
    const store = createMockStore();
    const executor = new TaskExecutor(store, "/tmp/test");
    const audit = { git: vi.fn().mockResolvedValue(undefined) };

    await (executor as any).captureBaseCommitSha(makeTask({ baseCommitSha: "old123" }), "/tmp/test/.worktrees/fn-4383", audit);

    expect(store.updateTask).not.toHaveBeenCalled();
    expect(audit.git).toHaveBeenCalledWith(expect.objectContaining({ metadata: { purpose: "base", preserved: true } }));
  });

  it("recaptures when existing baseCommitSha is not ancestor", async () => {
    mockedExecSync.mockImplementation(() => {
      throw new Error("not ancestor");
    });
    mockedExec.mockImplementation((cmd: any, _opts: any, cb: any) => cb(null, cmd.includes("merge-base") ? "new456\n" : ""));
    const store = createMockStore();
    const executor = new TaskExecutor(store, "/tmp/test");
    const audit = { git: vi.fn().mockResolvedValue(undefined) };

    await (executor as any).captureBaseCommitSha(makeTask({ baseCommitSha: "stale999" }), "/tmp/test/.worktrees/fn-4383", audit);

    expect(store.updateTask).toHaveBeenCalledWith("FN-4383", { baseCommitSha: "new456" });
  });

  it("preserves prior merge base for FN-4309/FN-4383 multi-session regression", async () => {
    mockedExecSync.mockReturnValue("");
    const store = createMockStore();
    const executor = new TaskExecutor(store, "/tmp/test");
    const audit = { git: vi.fn().mockResolvedValue(undefined) };

    await (executor as any).captureBaseCommitSha(makeTask({ baseCommitSha: "merge_base_sha" }), "/tmp/test/.worktrees/fn-4383", audit);

    expect(store.updateTask).not.toHaveBeenCalled();
    expect(audit.git).toHaveBeenCalledWith(expect.objectContaining({ metadata: { purpose: "base", preserved: true } }));
  });

  it("falls back to HEAD when merge-base fails", async () => {
    mockedExec.mockImplementation((cmd: any, _opts: any, cb: any) => {
      if (String(cmd).includes("merge-base")) {
        cb(new Error("merge-base failed"), "", "merge-base failed");
        return;
      }
      cb(null, "head777\n", "");
    });
    const store = createMockStore();
    const executor = new TaskExecutor(store, "/tmp/test");
    const audit = { git: vi.fn().mockResolvedValue(undefined) };

    await (executor as any).captureBaseCommitSha(makeTask(), "/tmp/test/.worktrees/fn-4383", audit);

    expect(store.updateTask).toHaveBeenCalledWith("FN-4383", { baseCommitSha: "head777" });
    expect(vi.mocked(executorLog.warn)).toHaveBeenCalledWith(expect.stringContaining("falling back to HEAD"));
  });
});
