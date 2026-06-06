// @vitest-environment node
//
// Company-model U6: task-keyed Reviewer verdict store (task_reviewer_runs).
// Proves CRUD, the write-once invariant (terminal + pass-writer-identity), the
// latest-verdict / running-run / stale-run query surface, and the v116 migration
// invariant (SCHEMA_VERSION equals the highest applyMigration target).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTaskStoreTestHarness } from "./store-test-helpers.js";
import {
  ReviewerRunTerminalError,
  ReviewerRunWriterError,
} from "../task-reviewer-store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("TaskReviewerStore — CRUD + write-once (U6)", () => {
  const h = createTaskStoreTestHarness();
  beforeEach(h.beforeEach);
  afterEach(h.afterEach);

  it("starts a run in running status and reads it back", () => {
    const rs = h.store().getTaskReviewerStore();
    const run = rs.startReviewerRun("T-1", {
      boardId: "B-1",
      reviewerAgentId: "agent-reviewer",
      reworkRound: 0,
    });
    expect(run.status).toBe("running");
    expect(run.taskId).toBe("T-1");
    expect(run.boardId).toBe("B-1");
    expect(run.reviewerAgentId).toBe("agent-reviewer");
    expect(rs.getRun(run.id)?.status).toBe("running");
    expect(rs.hasRunningRun("T-1")).toBe(true);
    expect(rs.getLatestVerdict("T-1")).toBeUndefined();
  });

  it("completes a pass verdict written by the reviewer identity and exposes it as latest", () => {
    const rs = h.store().getTaskReviewerStore();
    const run = rs.startReviewerRun("T-2", { reviewerAgentId: "rev" });
    const done = rs.completeReviewerRun(run.id, {
      status: "pass",
      summary: "looks good",
      writerAgentId: "rev",
    });
    expect(done.status).toBe("pass");
    expect(rs.hasPassingVerdict("T-2")).toBe(true);
    expect(rs.getLatestVerdict("T-2")?.status).toBe("pass");
    expect(rs.hasRunningRun("T-2")).toBe(false);
  });

  it("persists structured failure reasons on a fail verdict", () => {
    const rs = h.store().getTaskReviewerStore();
    const run = rs.startReviewerRun("T-3", { reviewerAgentId: "rev" });
    const done = rs.completeReviewerRun(run.id, {
      status: "fail",
      summary: "nope",
      failureReasons: [{ title: "missing test", message: "no coverage", expected: "tests", actual: "none" }],
    });
    expect(done.status).toBe("fail");
    expect(done.failureReasons?.[0].title).toBe("missing test");
    expect(rs.getLatestVerdict("T-3")?.status).toBe("fail");
    expect(rs.hasPassingVerdict("T-3")).toBe(false);
  });

  it("write-once: a second complete on a terminal run is rejected (typed)", () => {
    const rs = h.store().getTaskReviewerStore();
    const run = rs.startReviewerRun("T-4", { reviewerAgentId: "rev" });
    rs.completeReviewerRun(run.id, { status: "fail", summary: "first" });
    expect(() =>
      rs.completeReviewerRun(run.id, { status: "pass", summary: "second", writerAgentId: "rev" }),
    ).toThrow(ReviewerRunTerminalError);
  });

  it("write-once authority: a pass written by a non-reviewer identity is rejected (typed)", () => {
    const rs = h.store().getTaskReviewerStore();
    const run = rs.startReviewerRun("T-5", { reviewerAgentId: "rev" });
    expect(() =>
      rs.completeReviewerRun(run.id, { status: "pass", summary: "sneaky", writerAgentId: "imposter" }),
    ).toThrow(ReviewerRunWriterError);
    // The run is still running (rejected before any write).
    expect(rs.getRun(run.id)?.status).toBe("running");
  });

  it("a non-pass verdict is NOT identity-gated (recovery may terminate an orphan)", () => {
    const rs = h.store().getTaskReviewerStore();
    const run = rs.startReviewerRun("T-6", { reviewerAgentId: "rev" });
    const done = rs.completeReviewerRun(run.id, { status: "fail", writerAgentId: "someone-else" });
    expect(done.status).toBe("fail");
  });

  it("listStaleRunningRuns + reapRun move an old running run to error", () => {
    const rs = h.store().getTaskReviewerStore();
    const run = rs.startReviewerRun("T-7", { reviewerAgentId: "rev" });
    // startedAt is now; query with a future `now` so the run looks stale.
    const future = Date.now() + 10_000;
    const stale = rs.listStaleRunningRuns(1, future);
    expect(stale.map((r) => r.id)).toContain(run.id);
    const reaped = rs.reapRun(run.id, "owner gone");
    expect(reaped.status).toBe("error");
    expect(reaped.summary).toBe("owner gone");
    // Reaping an already-terminal run is a no-op.
    expect(rs.reapRun(run.id, "again").status).toBe("error");
  });

  it("getLatestVerdict returns the most recent terminal run across rework rounds", () => {
    const rs = h.store().getTaskReviewerStore();
    const r1 = rs.startReviewerRun("T-8", { reviewerAgentId: "rev", reworkRound: 0 });
    rs.completeReviewerRun(r1.id, { status: "fail", summary: "round 0" });
    const r2 = rs.startReviewerRun("T-8", { reviewerAgentId: "rev", reworkRound: 1 });
    rs.completeReviewerRun(r2.id, { status: "pass", summary: "round 1", writerAgentId: "rev" });
    expect(rs.getLatestVerdict("T-8")?.status).toBe("pass");
    expect(rs.listRunsForTask("T-8")).toHaveLength(2);
  });
});

describe("TaskReviewerStore — pass-verdict invalidation on reopen (FN #2)", () => {
  const h = createTaskStoreTestHarness();
  beforeEach(h.beforeEach);
  afterEach(h.afterEach);

  it("invalidateLatestPassVerdict makes getLatestVerdict skip the superseded pass", () => {
    const rs = h.store().getTaskReviewerStore();
    const run = rs.startReviewerRun("T-INV", { reviewerAgentId: "rev" });
    rs.completeReviewerRun(run.id, { status: "pass", summary: "ok", writerAgentId: "rev" });
    expect(rs.hasPassingVerdict("T-INV")).toBe(true);

    const invalidated = rs.invalidateLatestPassVerdict("T-INV");
    expect(invalidated?.id).toBe(run.id);
    expect(invalidated?.invalidatedAt).toBeTruthy();
    // The stale pass is no longer the latest verdict, so the exit gate / drive
    // idempotency both see "no verdict" and force a fresh run.
    expect(rs.getLatestVerdict("T-INV")).toBeUndefined();
    expect(rs.hasPassingVerdict("T-INV")).toBe(false);
  });

  it("preserves write-once: the verdict row status is untouched (only invalidatedAt is set)", () => {
    const rs = h.store().getTaskReviewerStore();
    const run = rs.startReviewerRun("T-INV2", { reviewerAgentId: "rev" });
    rs.completeReviewerRun(run.id, { status: "pass", summary: "ok", writerAgentId: "rev" });
    rs.invalidateLatestPassVerdict("T-INV2");
    // Row still PASS (write-once); only the marker changed. The row remains in
    // history (listRunsForTask) for round accounting.
    expect(rs.getRun(run.id)?.status).toBe("pass");
    expect(rs.getRun(run.id)?.invalidatedAt).toBeTruthy();
    expect(rs.listRunsForTask("T-INV2")).toHaveLength(1);
    // Completing it again is still rejected (terminal write-once intact).
    expect(() =>
      rs.completeReviewerRun(run.id, { status: "pass", summary: "x", writerAgentId: "rev" }),
    ).toThrow(ReviewerRunTerminalError);
  });

  it("is a no-op when the latest verdict is not a live pass", () => {
    const rs = h.store().getTaskReviewerStore();
    // No verdict yet.
    expect(rs.invalidateLatestPassVerdict("T-NONE")).toBeUndefined();
    // A fail is not invalidated (rework flow's fail runs already cover that case).
    const failRun = rs.startReviewerRun("T-FAIL", { reviewerAgentId: "rev" });
    rs.completeReviewerRun(failRun.id, { status: "fail", summary: "nope" });
    expect(rs.invalidateLatestPassVerdict("T-FAIL")).toBeUndefined();
    expect(rs.getLatestVerdict("T-FAIL")?.status).toBe("fail");
    // A second invalidate of an already-invalidated pass is a no-op.
    const passRun = rs.startReviewerRun("T-DBL", { reviewerAgentId: "rev" });
    rs.completeReviewerRun(passRun.id, { status: "pass", summary: "ok", writerAgentId: "rev" });
    expect(rs.invalidateLatestPassVerdict("T-DBL")?.id).toBe(passRun.id);
    expect(rs.invalidateLatestPassVerdict("T-DBL")).toBeUndefined();
  });

  it("emits reviewer-run:invalidated (and not :completed) on supersession", () => {
    const rs = h.store().getTaskReviewerStore();
    const run = rs.startReviewerRun("T-EVT", { reviewerAgentId: "rev" });
    rs.completeReviewerRun(run.id, { status: "pass", summary: "ok", writerAgentId: "rev" });

    const invalidatedEvents: string[] = [];
    const completedEvents: string[] = [];
    rs.on("reviewer-run:invalidated", (r) => invalidatedEvents.push(r.id));
    rs.on("reviewer-run:completed", (r) => completedEvents.push(r.id));

    const result = rs.invalidateLatestPassVerdict("T-EVT");
    // The supersession emits the dedicated event carrying the now-invalidated run,
    // and does NOT masquerade as a fresh terminal verdict (:completed).
    expect(invalidatedEvents).toEqual([run.id]);
    expect(completedEvents).toEqual([]);
    expect(result?.invalidatedAt).toBeTruthy();
  });

  it("does not emit on a no-op invalidate (no live pass)", () => {
    const rs = h.store().getTaskReviewerStore();
    const seen: string[] = [];
    rs.on("reviewer-run:invalidated", (r) => seen.push(r.id));
    expect(rs.invalidateLatestPassVerdict("T-NOEVT")).toBeUndefined();
    expect(seen).toEqual([]);
  });

  it("a fresh pass after invalidation becomes the live verdict again", () => {
    const rs = h.store().getTaskReviewerStore();
    const r1 = rs.startReviewerRun("T-RE", { reviewerAgentId: "rev" });
    rs.completeReviewerRun(r1.id, { status: "pass", summary: "first", writerAgentId: "rev" });
    rs.invalidateLatestPassVerdict("T-RE");
    expect(rs.getLatestVerdict("T-RE")).toBeUndefined();
    // Re-enter in-review → new run → new pass lands.
    const r2 = rs.startReviewerRun("T-RE", { reviewerAgentId: "rev" });
    rs.completeReviewerRun(r2.id, { status: "pass", summary: "second", writerAgentId: "rev" });
    expect(rs.getLatestVerdict("T-RE")?.id).toBe(r2.id);
    expect(rs.hasPassingVerdict("T-RE")).toBe(true);
  });
});

describe("U6 migration — SCHEMA_VERSION invariant", () => {
  it("SCHEMA_VERSION equals the highest applyMigration target", () => {
    const src = readFileSync(join(__dirname, "..", "db.ts"), "utf8");
    const versionMatch = src.match(/const SCHEMA_VERSION = (\d+);/);
    expect(versionMatch).toBeTruthy();
    const declared = Number(versionMatch![1]);
    const targets = [...src.matchAll(/applyMigration\((\d+),/g)].map((m) => Number(m[1]));
    const highest = Math.max(...targets);
    expect(declared).toBe(highest);
  });

  it("v119 seed-at-v118: migration adds the invalidatedAt column idempotently", () => {
    const h = createTaskStoreTestHarness();
    return (async () => {
      await h.beforeEach();
      try {
        const store = h.store();
        const db = (store as unknown as {
          db: {
            prepare: (s: string) => {
              run: (...a: unknown[]) => unknown;
              all: (...a: unknown[]) => Array<{ name: string }>;
            };
            init: () => void;
          };
        }).db;
        // Simulate a DB seeded at v118 (pre-invalidation): drop the column and
        // reset the stored schema version. node:sqlite supports DROP COLUMN.
        db.prepare(`ALTER TABLE task_reviewer_runs DROP COLUMN invalidatedAt`).run();
        const before = db
          .prepare(`PRAGMA table_info(task_reviewer_runs)`)
          .all()
          .map((c) => c.name);
        expect(before).not.toContain("invalidatedAt");
        db.prepare(`UPDATE __meta SET value = '118' WHERE key = 'schemaVersion'`).run();

        // Re-run migrations: v119 restores the column.
        db.init();
        const after = db
          .prepare(`PRAGMA table_info(task_reviewer_runs)`)
          .all()
          .map((c) => c.name);
        expect(after).toContain("invalidatedAt");

        // Idempotent: re-running is a no-op (no throw, column stays).
        db.init();
        const again = db
          .prepare(`PRAGMA table_info(task_reviewer_runs)`)
          .all()
          .map((c) => c.name);
        expect(again).toContain("invalidatedAt");

        // The store works end-to-end on the migrated DB.
        const rs = store.getTaskReviewerStore();
        const run = rs.startReviewerRun("T-mig", { reviewerAgentId: "rev" });
        rs.completeReviewerRun(run.id, { status: "pass", summary: "ok", writerAgentId: "rev" });
        expect(rs.invalidateLatestPassVerdict("T-mig")?.invalidatedAt).toBeTruthy();
        expect(rs.getLatestVerdict("T-mig")).toBeUndefined();
      } finally {
        await h.afterEach();
      }
    })();
  });

  it("fresh DB has the task_reviewer_runs table", () => {
    const h = createTaskStoreTestHarness();
    return (async () => {
      await h.beforeEach();
      try {
        const rs = h.store().getTaskReviewerStore();
        // A successful start proves the table exists in a fresh (SCHEMA_SQL) DB.
        const run = rs.startReviewerRun("T-fresh", { reviewerAgentId: "rev" });
        expect(run.id).toMatch(/^RR-/);
      } finally {
        await h.afterEach();
      }
    })();
  });
});
