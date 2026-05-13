import { describe, it, expect, vi, beforeEach } from "vitest";
import { acquireTaskWorktree } from "../worktree-acquisition.js";

vi.mock("../worktree-pool.js", async () => {
  const actual = await vi.importActual<any>("../worktree-pool.js");
  return { ...actual, isUsableTaskWorktree: vi.fn().mockResolvedValue(true) };
});

vi.mock("../worktree-db-hydrate.js", () => ({
  hydrateWorktreeDb: vi.fn().mockResolvedValue({ degraded: false, tasksCopied: 1, documentsCopied: 1 }),
}));

describe("acquireTaskWorktree", () => {
  const task = {
    id: "FN-1",
    title: "Task",
    description: "Desc",
    branch: null,
    worktree: null,
  } as any;

  let store: any;
  beforeEach(() => {
    store = {
      updateTask: vi.fn().mockResolvedValue(undefined),
      logEntry: vi.fn().mockResolvedValue(undefined),
    };
  });

  it("reuses existing usable worktree", async () => {
    const result = await acquireTaskWorktree({
      task: { ...task, worktree: process.cwd(), branch: "fusion/fn-1" },
      rootDir: process.cwd(),
      store,
      settings: {},
      createWorktree: vi.fn(),
    });
    expect(result.source).toBe("existing");
    expect(result.worktreePath).toBe(process.cwd());
  });

  it("acquires from pool when enabled", async () => {
    const prepareForTask = vi.fn().mockResolvedValue("fusion/fn-1");
    const result = await acquireTaskWorktree({
      task,
      rootDir: process.cwd(),
      store,
      settings: { recycleWorktrees: true } as any,
      pool: {
        acquire: () => "/tmp/pooled",
        prepareForTask,
        release: vi.fn(),
      } as any,
      createWorktree: vi.fn(),
    });
    expect(result.source).toBe("pool");
    expect(prepareForTask).toHaveBeenCalled();
    expect(store.updateTask).toHaveBeenCalledWith("FN-1", { worktree: "/tmp/pooled", branch: "fusion/fn-1" });
  });

  it("creates fresh when pool disabled", async () => {
    const createWorktree = vi.fn().mockResolvedValue({ path: "/tmp/new", branch: "fusion/fn-1" });
    const result = await acquireTaskWorktree({
      task,
      rootDir: process.cwd(),
      store,
      settings: {},
      createWorktree,
    });
    expect(result.source).toBe("fresh");
    expect(createWorktree).toHaveBeenCalled();
    expect(store.updateTask).toHaveBeenCalledWith("FN-1", { worktree: "/tmp/new", branch: "fusion/fn-1" });
  });

  it("skips init command when runInitCommand false", async () => {
    const runConfiguredCommand = vi.fn();
    await acquireTaskWorktree({
      task,
      rootDir: process.cwd(),
      store,
      settings: { worktreeInitCommand: "pnpm i" } as any,
      createWorktree: vi.fn().mockResolvedValue({ path: "/tmp/new", branch: "fusion/fn-1" }),
      runConfiguredCommand,
      runInitCommand: false,
    });
    expect(runConfiguredCommand).not.toHaveBeenCalled();
  });
});
