import { describe, it, expect, vi, beforeEach } from "vitest";
import { acquireTaskWorktree } from "../worktree-acquisition.js";

// Mirror the heavy filesystem/git mocks from worktree-acquisition.test.ts so the
// fresh-creation path runs without touching a real repo.
vi.mock("../worktree-pool.js", async () => {
  const actual = await vi.importActual<any>("../worktree-pool.js");
  return {
    ...actual,
    classifyTaskWorktree: vi.fn().mockResolvedValue({ ok: true }),
    isInsideWorktreesDir: vi.fn().mockReturnValue(true),
  };
});

vi.mock("../branch-conflicts.js", async () => {
  const actual = await vi.importActual<any>("../branch-conflicts.js");
  return {
    ...actual,
    classifyBootstrapMisbinding: vi.fn().mockResolvedValue({
      isBootstrapMisbinding: false,
      ownCommitCount: 0,
      foreignCommitCount: 0,
      nonAttributedCount: 0,
    }),
    reanchorBranchToBase: vi.fn().mockResolvedValue({ previousTipSha: "abc", newTipSha: "def" }),
  };
});

vi.mock("../worktree-db-hydrate.js", () => ({
  hydrateWorktreeDb: vi.fn().mockResolvedValue({ degraded: false, tasksCopied: 0, documentsCopied: 0 }),
}));

vi.mock("../worktree-desktop-artifacts.js", () => ({
  removeDesktopBuildArtifacts: vi.fn().mockResolvedValue({ removed: [], skipped: [], failures: [] }),
}));

vi.mock("../secrets-env-writer.js", () => ({
  writeSecretsEnvFile: vi.fn().mockResolvedValue(undefined),
}));

const baseTask = {
  id: "FN-1",
  title: "Task",
  description: "Desc",
  branch: null,
  worktree: null,
} as any;

function makeStore() {
  const auditRows: any[] = [];
  return {
    rows: auditRows,
    updateTask: vi.fn().mockResolvedValue(undefined),
    logEntry: vi.fn().mockResolvedValue(undefined),
    getRunAuditEvents: vi.fn((filter: any) =>
      auditRows.filter((r) => (!filter?.mutationType || r.mutationType === filter.mutationType)),
    ),
    recordRunAuditEvent: vi.fn((input: any) => {
      const row = { id: `evt-${auditRows.length}`, timestamp: new Date().toISOString(), ...input };
      auditRows.push(row);
      return row;
    }),
  } as any;
}

describe("acquireTaskWorktree worktree-policy gate (U11, R23)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("simple mode with stored worktree-disabled STILL creates an isolated worktree", async () => {
    const store = makeStore();
    const createWorktree = vi.fn(async (branchName: string, worktreePath: string) => ({ path: worktreePath, branch: branchName }));

    const result = await acquireTaskWorktree({
      task: { ...baseTask, worktree: null },
      rootDir: process.cwd(),
      store,
      // Stored setting says worktrees off, but simple mode forces them on.
      settings: { uiMode: "simple", worktreeIsolationEnabled: false } as any,
      createWorktree,
    });

    expect(result.source).toBe("fresh");
    expect(result.worktreePath).not.toBe(process.cwd());
    expect(createWorktree).toHaveBeenCalledTimes(1);
  });

  it("advanced mode with stored worktree-disabled runs in the project root (no worktree created)", async () => {
    const store = makeStore();
    const createWorktree = vi.fn();

    const result = await acquireTaskWorktree({
      task: { ...baseTask, worktree: null },
      rootDir: process.cwd(),
      store,
      settings: { uiMode: "advanced", worktreeIsolationEnabled: false } as any,
      createWorktree,
    });

    expect(result.source).toBe("disabled");
    expect(result.worktreePath).toBe(process.cwd());
    expect(result.branch).toBe("fusion/fn-1");
    expect(createWorktree).not.toHaveBeenCalled();
  });

  it("advanced mode with worktrees enabled creates a worktree as usual", async () => {
    const store = makeStore();
    const createWorktree = vi.fn(async (branchName: string, worktreePath: string) => ({ path: worktreePath, branch: branchName }));

    const result = await acquireTaskWorktree({
      task: { ...baseTask, worktree: null },
      rootDir: process.cwd(),
      store,
      settings: { uiMode: "advanced", worktreeIsolationEnabled: true } as any,
      createWorktree,
    });

    expect(result.source).toBe("fresh");
    expect(createWorktree).toHaveBeenCalledTimes(1);
  });

  describe("one-time force-on notice", () => {
    it("records the simple-mode-forced audit event exactly once per project", async () => {
      const store = makeStore();
      const createWorktree = vi.fn(async (branchName: string, worktreePath: string) => ({ path: worktreePath, branch: branchName }));
      const settings = { uiMode: "simple", worktreeIsolationEnabled: false } as any;

      await acquireTaskWorktree({ task: { ...baseTask, id: "FN-1", worktree: null }, rootDir: process.cwd(), store, settings, createWorktree });
      await acquireTaskWorktree({ task: { ...baseTask, id: "FN-2", worktree: null }, rootDir: process.cwd(), store, settings, createWorktree });
      await acquireTaskWorktree({ task: { ...baseTask, id: "FN-3", worktree: null }, rootDir: process.cwd(), store, settings, createWorktree });

      const forced = store.rows.filter((r: any) => r.mutationType === "worktree:simple-mode-forced");
      expect(forced).toHaveLength(1);
      expect(forced[0]).toMatchObject({
        domain: "git",
        metadata: { storedWorktreeIsolationEnabled: false, advancedModeOptOut: true },
      });
    });

    it("does NOT fire the notice when worktrees were already enabled in simple mode", async () => {
      const store = makeStore();
      const createWorktree = vi.fn(async (branchName: string, worktreePath: string) => ({ path: worktreePath, branch: branchName }));

      await acquireTaskWorktree({
        task: { ...baseTask, worktree: null },
        rootDir: process.cwd(),
        store,
        settings: { uiMode: "simple", worktreeIsolationEnabled: true } as any,
        createWorktree,
      });

      expect(store.rows.filter((r: any) => r.mutationType === "worktree:simple-mode-forced")).toHaveLength(0);
    });

    it("does NOT fire the notice in advanced mode", async () => {
      const store = makeStore();
      const createWorktree = vi.fn();

      await acquireTaskWorktree({
        task: { ...baseTask, worktree: null },
        rootDir: process.cwd(),
        store,
        settings: { uiMode: "advanced", worktreeIsolationEnabled: false } as any,
        createWorktree,
      });

      expect(store.rows.filter((r: any) => r.mutationType === "worktree:simple-mode-forced")).toHaveLength(0);
    });
  });
});
