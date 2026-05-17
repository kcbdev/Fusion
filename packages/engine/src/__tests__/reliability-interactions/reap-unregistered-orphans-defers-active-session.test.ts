/**
 * FN-4811: `reapUnregisteredOrphans()` must NOT `rmSync` a directory that
 * is currently bound to an active executor/merger/step session.
 *
 * Gap: the method used raw `rmSync` to remove unregistered worktree directories,
 * completely bypassing `removeWorktree()` and its `activeSessionRegistry` guard.
 * If an executor session's worktree admin entry was lost (e.g. git worktree prune
 * ran first), the sweep would delete the working directory out from under a live
 * session.
 *
 * Fix: add `activeSessionRegistry.isPathActive(path)` check before `rmSync`,
 * deferring removal to the next sweep when no session holds the path.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Settings, Task, TaskStore } from "@fusion/core";
import { SelfHealingManager } from "../../self-healing.js";
import { activeSessionRegistry } from "../../active-session-registry.js";
import * as worktreePool from "../../worktree-pool.js";
import * as worktreePaths from "../../worktree-paths.js";

function makeStore(worktreeDir: string): TaskStore & EventEmitter {
  const emitter = new EventEmitter();
  const settings = {
    globalPause: false,
    enginePaused: false,
    baseBranch: "main",
    worktrunk: { enabled: false },
  } as unknown as Settings;
  return Object.assign(emitter, {
    getSettings: vi.fn(async () => settings),
    getTask: vi.fn(async () => undefined),
    listTasks: vi.fn(async () => []),
    updateTask: vi.fn(async () => undefined),
    moveTask: vi.fn(async () => undefined),
    logEntry: vi.fn(async () => undefined),
    appendAgentLog: vi.fn(async () => undefined),
    updateSettings: vi.fn(async () => settings),
    clearStaleExecutionStartBranchReferences: vi.fn(() => []),
    recordRunAuditEvent: vi.fn(async () => undefined),
    walCheckpoint: vi.fn(() => ({ busy: 0, log: 0, checkpointed: 0 })),
    archiveTaskAndCleanup: vi.fn(async () => ({})),
    mergeTask: vi.fn(async () => undefined),
    getRootDir: vi.fn(() => worktreeDir),
  }) as unknown as TaskStore & EventEmitter;
}

describe("FN-4811: reapUnregisteredOrphans defers when directory has active session", () => {
  let testDir: string;
  let worktreesDir: string;

  beforeEach(() => {
    activeSessionRegistry.clear();
    vi.restoreAllMocks();
    testDir = join(tmpdir(), `fn4811-orphan-test-${Date.now()}`);
    worktreesDir = join(testDir, ".worktrees");
  });

  afterEach(() => {
    activeSessionRegistry.clear();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("skips rmSync for a directory registered as an active session path", async () => {
    // Create the orphan dir on disk.
    const orphanPath = join(worktreesDir, "active-orphan");
    mkdirSync(orphanPath, { recursive: true });

    const store = makeStore(testDir);

    // Register it as an active session — this is the live executor's worktree.
    activeSessionRegistry.registerPath(orphanPath, {
      taskId: "FN-4811",
      kind: "executor",
      ownerKey: "FN-4811",
    });

    // Mock resolveWorktreesDir to return our test .worktrees dir.
    vi.spyOn(worktreePaths, "resolveWorktreesDir").mockReturnValue(worktreesDir);

    // Mock getRegisteredWorktreePaths to NOT include the orphan (unregistered).
    vi.spyOn(worktreePool, "getRegisteredWorktreePaths").mockResolvedValue(new Set());

    const manager = new SelfHealingManager(store as any, {
      rootDir: testDir,
    } as any);

    const cleaned = await (manager as any).reapUnregisteredOrphans();

    // Should report 0 cleaned — the active session prevented removal.
    expect(cleaned).toBe(0);

    // The directory must still exist on disk.
    expect(existsSync(orphanPath)).toBe(true);

    manager.stop();
    activeSessionRegistry.clear();
  });

  it("DOES remove an unregistered orphan when no active session holds it (control)", async () => {
    const orphanPath = join(worktreesDir, "dead-orphan");
    mkdirSync(orphanPath, { recursive: true });

    const store = makeStore(testDir);

    // NOT registering — no active session.

    vi.spyOn(worktreePaths, "resolveWorktreesDir").mockReturnValue(worktreesDir);
    vi.spyOn(worktreePool, "getRegisteredWorktreePaths").mockResolvedValue(new Set());

    const manager = new SelfHealingManager(store as any, {
      rootDir: testDir,
    } as any);

    const cleaned = await (manager as any).reapUnregisteredOrphans();

    expect(cleaned).toBe(1);
    expect(existsSync(orphanPath)).toBe(false);

    manager.stop();
  });
});
