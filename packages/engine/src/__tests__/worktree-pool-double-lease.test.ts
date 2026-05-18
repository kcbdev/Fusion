import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn().mockReturnValue(true),
  lstatSync: vi.fn().mockReturnValue({ isDirectory: () => true, isSymbolicLink: () => false }),
  readdirSync: vi.fn().mockReturnValue([]),
  rmSync: vi.fn(),
  realpathSync: vi.fn((path: string) => path),
}));

import { WorktreePool } from "../worktree-pool.js";

// FN-4954 deterministic race backstop.
describe("WorktreePool double-lease guard", () => {
  let pool: WorktreePool;

  beforeEach(() => {
    pool = new WorktreePool();
  });

  it("prevents rehydrate from re-adding a leased path", () => {
    const violations: Array<{ phase: string; existingHolder: string }> = [];
    pool.setInvariantViolationHandler((violation) => {
      violations.push({ phase: violation.phase, existingHolder: violation.existingHolder });
    });

    pool.release("/tmp/wt-race");
    const firstLease = pool.acquire("FN-A");
    expect(firstLease).toBe("/tmp/wt-race");

    pool.rehydrate(["/tmp/wt-race"]);

    expect(pool.acquire("FN-B")).toBeNull();
    expect(pool.size).toBe(0);
    expect(pool.getLeasedPaths().get("/tmp/wt-race")).toBe("FN-A");
    expect(violations).toEqual([{ phase: "rehydrate", existingHolder: "FN-A" }]);
  });

  it("keeps release best-effort when releasing task differs", () => {
    const violations: Array<{ phase: string; requestingTaskId: string }> = [];
    pool.setInvariantViolationHandler((violation) => violations.push({ phase: violation.phase, requestingTaskId: violation.requestingTaskId }));

    pool.release("/tmp/wt-race");
    expect(pool.acquire("FN-A")).toBe("/tmp/wt-race");

    pool.release("/tmp/wt-race", "FN-B");
    expect(pool.has("/tmp/wt-race")).toBe(true);
    expect(pool.getLeasedPaths().size).toBe(0);
    expect(violations).toEqual([{ phase: "release", requestingTaskId: "FN-B" }]);
  });
});
