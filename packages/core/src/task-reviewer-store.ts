/**
 * TaskReviewerStore — persistence for task-keyed Reviewer verdict runs (U6).
 *
 * The company model has the Reviewer absorb the mission Validator: entering the
 * in-review column on a company-model board starts a run keyed to the board task,
 * and the persisted write-once verdict gates the exit from in-review. This store
 * mirrors the `mission-store.ts` validator-run methods (startValidatorRun /
 * completeValidatorRun / listStaleRunningValidatorRuns / reapValidatorRun) but
 * keyed to a task/board — the mission tables and their FK constraints stay
 * untouched, so mission-path integrity is unaffected.
 *
 * WRITE-ONCE INVARIANT (U6):
 *  - `completeReviewerRun` rejects (typed {@link ReviewerRunTerminalError}) when
 *    the run is already terminal (pass | fail | blocked | error).
 *  - A `pass` verdict may only be written by the run's `reviewerAgentId`
 *    identity; a mismatch is rejected (typed {@link ReviewerRunWriterError}).
 *    Non-pass verdicts (fail/blocked/error — e.g. a recovery reap) are not
 *    identity-gated so the self-healing sweep can terminate an orphan.
 *
 * Distinct from MissionStore's run engine — task verdicts persist in their own
 * `task_reviewer_runs` table. The two share no rows and no FKs.
 */

import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { Database } from "./db.js";
import {
  type TaskReviewerRun,
  type TaskReviewerRunStatus,
  type TaskReviewerFailureReason,
  TERMINAL_TASK_REVIEWER_RUN_STATUSES,
} from "./mission-types.js";

// NOTE (AE6 dead-path removal, FN review): a task-log "manual approval" marker
// (`MANUAL_APPROVAL_LOG_PREFIX` + a `hasManualApprovalMarker` log reader) used to
// live here, intended for the case where a human owner dragged a task out of
// in-review without a passing verdict. The strict company-model movement matrix
// (workflow-transitions.ts) forbids ANY human drag out of in-review, so that seam
// can never fire and NOTHING in production ever wrote the marker — it was a
// read-but-never-written dead gate path. Manual merge approval flows exclusively
// through the existing Manual-required / merge-request affordances (a per-task
// `autoMerge: false` → the chokepoint's `manual-required` route), not a drag.
// The dead read + prefix were removed; the pure `shouldAutoMergeTask` predicate
// keeps a generic `hasManualApprovalMarker` boolean input as a documented seam
// for any FUTURE explicit merge-request-approval wiring, but the engine binding
// passes it `false` today (see auto-merge-gate-engine.ts).

/** Thrown when completing a run that is already terminal (write-once). */
export class ReviewerRunTerminalError extends Error {
  constructor(
    public readonly runId: string,
    public readonly currentStatus: TaskReviewerRunStatus,
  ) {
    super(
      `Reviewer run '${runId}' is already terminal (status='${currentStatus}'); ` +
        `the verdict is write-once and cannot be re-written`,
    );
    this.name = "ReviewerRunTerminalError";
  }
}

/** Thrown when a non-owner identity attempts to write a `pass` verdict. */
export class ReviewerRunWriterError extends Error {
  constructor(
    public readonly runId: string,
    public readonly expectedAgentId: string | undefined,
    public readonly actualAgentId: string | undefined,
  ) {
    super(
      `Reviewer run '${runId}' pass verdict may only be written by its reviewer ` +
        `identity '${expectedAgentId ?? "(none)"}'; got '${actualAgentId ?? "(none)"}'`,
    );
    this.name = "ReviewerRunWriterError";
  }
}

interface TaskReviewerRunRow {
  id: string;
  taskId: string;
  boardId: string;
  status: string;
  summary: string | null;
  failureReasons: string | null;
  reviewerAgentId: string | null;
  reworkRound: number;
  startedAt: string;
  completedAt: string | null;
  invalidatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A completion verdict written to a run. */
export interface ReviewerVerdict {
  /** Terminal status to write. */
  status: "pass" | "fail" | "blocked" | "error";
  /** Verdict summary. */
  summary?: string;
  /** Structured failure reasons (for fail/blocked). */
  failureReasons?: TaskReviewerFailureReason[];
  /** The writer's effective-agent identity. Required + enforced for `pass`. */
  writerAgentId?: string;
}

export type TaskReviewerStoreEvents = {
  "reviewer-run:started": [TaskReviewerRun];
  "reviewer-run:completed": [TaskReviewerRun];
  /**
   * A previously-terminal PASS verdict was superseded (its `invalidatedAt`
   * marker set) by {@link TaskReviewerStore.invalidateLatestPassVerdict}. The
   * carried run is the now-invalidated verdict. Emitted as a distinct event
   * (NOT `reviewer-run:completed`) because the run is not freshly completing —
   * its write-once `status` is untouched; only its coverage is being revoked, so
   * event-driven consumers can react to the supersession without mistaking it
   * for a new terminal verdict.
   */
  "reviewer-run:invalidated": [TaskReviewerRun];
};

export class TaskReviewerStore extends EventEmitter<TaskReviewerStoreEvents> {
  constructor(private db: Database) {
    super();
    this.setMaxListeners(100);
  }

  private rowToRun(row: TaskReviewerRunRow): TaskReviewerRun {
    let failureReasons: TaskReviewerFailureReason[] | undefined;
    if (row.failureReasons) {
      try {
        const parsed = JSON.parse(row.failureReasons);
        if (Array.isArray(parsed)) failureReasons = parsed as TaskReviewerFailureReason[];
      } catch {
        failureReasons = undefined;
      }
    }
    return {
      id: row.id,
      taskId: row.taskId,
      boardId: row.boardId,
      status: row.status as TaskReviewerRunStatus,
      summary: row.summary ?? undefined,
      failureReasons,
      reviewerAgentId: row.reviewerAgentId ?? undefined,
      reworkRound: row.reworkRound,
      startedAt: row.startedAt,
      completedAt: row.completedAt ?? undefined,
      invalidatedAt: row.invalidatedAt ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private generateRunId(): string {
    return `RR-${randomUUID().slice(0, 8).toUpperCase()}`;
  }

  /**
   * Start a Reviewer run for a task entering in-review. The run starts in
   * `running` status owned by `reviewerAgentId` (the board's Reviewer effective
   * agent). `reworkRound` should be the count of prior fail cycles for the task.
   *
   * CONTRACT — `reviewerAgentId` is OPTIONAL by deliberate design, but identity
   * gating means an identity-less run can only ever reach a non-pass terminal
   * (fail/blocked/error). {@link completeReviewerRun} FAILS CLOSED: a `pass`
   * verdict requires the run to carry a `reviewerAgentId` and the writer to match
   * it, so a run started without an identity can never pass — it can only be
   * failed or reaped-to-error. The sole production caller (engine ReviewerGate)
   * resolves the identity from the reviewer column's agent binding, which is
   * legitimately absent when the company board's reviewer column has no agent
   * assigned; in that configuration a run that cannot be attributed to a
   * reviewer MUST NOT be allowed to pass, so the optional param + fail-closed
   * completion is the intended (not accidental) behaviour.
   */
  startReviewerRun(
    taskId: string,
    options: { boardId?: string; reviewerAgentId?: string; reworkRound?: number } = {},
  ): TaskReviewerRun {
    const now = new Date().toISOString();
    const run: TaskReviewerRun = {
      id: this.generateRunId(),
      taskId,
      boardId: options.boardId ?? "",
      status: "running",
      reviewerAgentId: options.reviewerAgentId,
      reworkRound: options.reworkRound ?? 0,
      startedAt: now,
      createdAt: now,
      updatedAt: now,
    };

    this.db
      .prepare(
        `INSERT INTO task_reviewer_runs
          (id, taskId, boardId, status, summary, failureReasons, reviewerAgentId, reworkRound, startedAt, completedAt, invalidatedAt, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.id,
        run.taskId,
        run.boardId,
        run.status,
        null,
        null,
        run.reviewerAgentId ?? null,
        run.reworkRound,
        run.startedAt,
        null,
        null,
        run.createdAt,
        run.updatedAt,
      );

    this.db.bumpLastModified();
    this.emit("reviewer-run:started", run);
    return run;
  }

  /**
   * Complete a Reviewer run with a verdict. Write-once:
   *  - throws {@link ReviewerRunTerminalError} when the run is already terminal;
   *  - throws {@link ReviewerRunWriterError} when a `pass` verdict is written by
   *    an identity other than the run's `reviewerAgentId`.
   */
  completeReviewerRun(runId: string, verdict: ReviewerVerdict): TaskReviewerRun {
    const existing = this.getRun(runId);
    if (!existing) {
      throw new Error(`Reviewer run '${runId}' not found`);
    }
    if (TERMINAL_TASK_REVIEWER_RUN_STATUSES.has(existing.status)) {
      throw new ReviewerRunTerminalError(runId, existing.status);
    }
    if (verdict.status === "pass") {
      // A pass may only be written by the run's reviewer identity. When the run
      // has no recorded reviewer identity, any writer is rejected (fail closed).
      if (
        !existing.reviewerAgentId ||
        verdict.writerAgentId !== existing.reviewerAgentId
      ) {
        throw new ReviewerRunWriterError(
          runId,
          existing.reviewerAgentId,
          verdict.writerAgentId,
        );
      }
    }

    const now = new Date().toISOString();
    const failureReasonsJson =
      verdict.failureReasons && verdict.failureReasons.length > 0
        ? JSON.stringify(verdict.failureReasons)
        : null;

    this.db
      .prepare(
        `UPDATE task_reviewer_runs SET
          status = ?, summary = ?, failureReasons = ?, completedAt = ?, updatedAt = ?
         WHERE id = ?`,
      )
      .run(verdict.status, verdict.summary ?? null, failureReasonsJson, now, now, runId);

    this.db.bumpLastModified();
    const updated = this.getRun(runId)!;
    this.emit("reviewer-run:completed", updated);
    return updated;
  }

  /** Get a run by id, or undefined. */
  getRun(runId: string): TaskReviewerRun | undefined {
    const row = this.db
      .prepare(`SELECT * FROM task_reviewer_runs WHERE id = ?`)
      .get(runId) as TaskReviewerRunRow | undefined;
    return row ? this.rowToRun(row) : undefined;
  }

  /** All runs for a task, newest first. */
  listRunsForTask(taskId: string): TaskReviewerRun[] {
    const rows = this.db
      .prepare(`SELECT * FROM task_reviewer_runs WHERE taskId = ? ORDER BY startedAt DESC, rowid DESC`)
      .all(taskId) as TaskReviewerRunRow[];
    return rows.map((r) => this.rowToRun(r));
  }

  /** The most recent run for a task (any status), or undefined. */
  getLatestRun(taskId: string): TaskReviewerRun | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM task_reviewer_runs WHERE taskId = ? ORDER BY startedAt DESC, rowid DESC LIMIT 1`,
      )
      .get(taskId) as TaskReviewerRunRow | undefined;
    return row ? this.rowToRun(row) : undefined;
  }

  /**
   * The latest TERMINAL verdict for a task, or undefined when no run has yet
   * reached a terminal status. The done-transition gate consults this: an agent
   * may only exit in-review when the latest verdict is `pass`.
   */
  getLatestVerdict(taskId: string): TaskReviewerRun | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM task_reviewer_runs
         WHERE taskId = ? AND status IN ('pass','fail','blocked','error')
           AND invalidatedAt IS NULL
         ORDER BY completedAt DESC, startedAt DESC, rowid DESC LIMIT 1`,
      )
      .get(taskId) as TaskReviewerRunRow | undefined;
    return row ? this.rowToRun(row) : undefined;
  }

  /**
   * Supersede the latest non-invalidated PASS verdict for a task (FN issue #2).
   *
   * Called when a task carrying a passing Reviewer verdict moves BACKWARD out of
   * in-review (a Lead/Reviewer agent reopen). Such a reopen records no fail run,
   * so the rework-round baseline is unchanged and the Reviewer gate would re-skip
   * on re-entry (`reworkRound >= priorFails`) and re-accept the STALE pass on
   * exit. Marking the pass invalidated makes {@link getLatestVerdict} ignore it,
   * so a fresh Reviewer run is forced and the exit gate blocks until a new verdict
   * lands.
   *
   * Write-once is preserved: the verdict row's `status` is not mutated — only the
   * separate `invalidatedAt` marker is written. A no-op (returns undefined) when
   * the latest verdict is not a live pass (already invalidated, or fail/blocked/
   * error, which the gate's round logic already handles).
   */
  invalidateLatestPassVerdict(taskId: string): TaskReviewerRun | undefined {
    const latest = this.getLatestVerdict(taskId);
    if (!latest || latest.status !== "pass") {
      return undefined;
    }
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE task_reviewer_runs SET invalidatedAt = ?, updatedAt = ? WHERE id = ?`,
      )
      .run(now, now, latest.id);
    this.db.bumpLastModified();
    const invalidated = this.getRun(latest.id)!;
    this.emit("reviewer-run:invalidated", invalidated);
    return invalidated;
  }

  /** True when the latest terminal verdict for a task is `pass`. */
  hasPassingVerdict(taskId: string): boolean {
    return this.getLatestVerdict(taskId)?.status === "pass";
  }

  /** True when the task has a currently-running (non-terminal) run. */
  hasRunningRun(taskId: string): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 AS found FROM task_reviewer_runs
         WHERE taskId = ? AND status IN ('pending','running') LIMIT 1`,
      )
      .get(taskId) as { found?: number } | undefined;
    return row?.found === 1;
  }

  /**
   * List running/pending runs whose `startedAt` is older than the supplied age
   * threshold — candidates the self-healing sweep reaps to `error` (mirror of
   * MissionStore.listStaleRunningValidatorRuns).
   */
  listStaleRunningRuns(maxAgeMs: number, now = Date.now()): TaskReviewerRun[] {
    const cutoff = new Date(now - maxAgeMs).toISOString();
    const rows = this.db
      .prepare(
        `SELECT * FROM task_reviewer_runs
         WHERE status IN ('pending','running') AND startedAt < ?
         ORDER BY startedAt ASC`,
      )
      .all(cutoff) as TaskReviewerRunRow[];
    return rows.map((r) => this.rowToRun(r));
  }

  /**
   * Reap a stale/orphaned running run to `error` (mirror of
   * MissionStore.reapValidatorRun). A no-op when the run is already terminal.
   * Not identity-gated: recovery must be able to terminate an orphan whose owner
   * is gone. The reason is recorded in the summary.
   */
  reapRun(runId: string, reason: string): TaskReviewerRun {
    const existing = this.getRun(runId);
    if (!existing) {
      throw new Error(`Reviewer run '${runId}' not found`);
    }
    if (TERMINAL_TASK_REVIEWER_RUN_STATUSES.has(existing.status)) {
      return existing;
    }
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE task_reviewer_runs SET status = 'error', summary = ?, completedAt = ?, updatedAt = ? WHERE id = ?`,
      )
      .run(reason, now, now, runId);
    this.db.bumpLastModified();
    const updated = this.getRun(runId)!;
    this.emit("reviewer-run:completed", updated);
    return updated;
  }
}
