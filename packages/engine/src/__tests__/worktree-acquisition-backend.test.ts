import { beforeEach, describe, expect, it, vi } from "vitest";
import { acquireTaskWorktree } from "../worktree-acquisition.js";
import type { WorktreeBackend } from "../worktree-backend.js";

vi.mock("../worktree-pool.js", async () => {
  const actual = await vi.importActual<any>("../worktree-pool.js");
  return { ...actual, isUsableTaskWorktree: vi.fn().mockResolvedValue(true) };
});

vi.mock("../worktree-db-hydrate.js", () => ({
  hydrateWorktreeDb: vi.fn().mockResolvedValue({ degraded: false, tasksCopied: 1, documentsCopied: 1 }),
}));

const { execMock } = vi.hoisted(() => {
  const mock = vi.fn();
  (mock as any)[Symbol.for("nodejs.util.promisify.custom")] = mock;
  return { execMock: mock };
});

vi.mock("node:child_process", () => ({ exec: execMock }));

describe("acquireTaskWorktree backend wiring", () => {
  const task = { id: "FN-1", title: "Task", description: "Desc", branch: null, worktree: null } as any;
  const store = {
    updateTask: vi.fn().mockResolvedValue(undefined),
    logEntry: vi.fn().mockResolvedValue(undefined),
  } as any;

  beforeEach(() => {
    execMock.mockReset();
    store.updateTask.mockClear();
    store.logEntry.mockClear();
  });

  it("uses native backend by default with expected git argv", async () => {
    execMock.mockResolvedValue({ stdout: "", stderr: "" });

    const result = await acquireTaskWorktree({
      task,
      rootDir: "/repo",
      store,
      settings: { worktreeNaming: "task-id" } as any,
    });

    expect(result.branch).toBe("fusion/fn-1");
    expect(result.worktreePath).toBe("/repo/.worktrees/fn-1");
    expect(execMock).toHaveBeenCalledWith(
      'git worktree add -b "fusion/fn-1" "/repo/.worktrees/fn-1"',
      expect.objectContaining({ cwd: "/repo" }),
    );
  });

  it("prefers explicit createWorktree override over resolved backend", async () => {
    const createWorktree = vi.fn().mockResolvedValue({ path: "/tmp/override", branch: "fusion/fn-override" });

    const result = await acquireTaskWorktree({
      task,
      rootDir: "/repo",
      store,
      settings: { worktreeNaming: "task-id", worktrunk: { enabled: true, binaryPath: "worktrunk" } } as any,
      createWorktree,
    });

    expect(result.worktreePath).toBe("/tmp/override");
    expect(result.branch).toBe("fusion/fn-override");
    expect(createWorktree).toHaveBeenCalledTimes(1);
    expect(execMock).not.toHaveBeenCalled();
  });

  it("throws WorktrunkOperationError when worktrunk is enabled", async () => {
    await expect(
      acquireTaskWorktree({
        task,
        rootDir: "/repo",
        store,
        settings: { worktreeNaming: "task-id", worktrunk: { enabled: true, binaryPath: "worktrunk" } } as any,
      }),
    ).rejects.toMatchObject({ name: "WorktrunkOperationError", code: "worktrunk_unsupported_operation" });

    expect(execMock).not.toHaveBeenCalled();
  });

  it("uses custom backend option instead of selector", async () => {
    const create = vi.fn().mockResolvedValue({ path: "/tmp/backend", branch: "fusion/fn-backend" });
    const backend: WorktreeBackend = {
      kind: "native",
      create,
      remove: vi.fn().mockResolvedValue(undefined),
      sync: vi.fn().mockResolvedValue({ skipped: true }),
      prune: vi.fn().mockResolvedValue(undefined),
    };

    const result = await acquireTaskWorktree({
      task,
      rootDir: "/repo",
      store,
      settings: { worktreeNaming: "task-id", worktrunk: { enabled: true } } as any,
      backend,
    });

    expect(result.worktreePath).toBe("/tmp/backend");
    expect(result.branch).toBe("fusion/fn-backend");
    expect(create).toHaveBeenCalledTimes(1);
    expect(execMock).not.toHaveBeenCalled();
  });
});
