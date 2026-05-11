import test from "node:test";
import assert from "node:assert/strict";

import { findTaskStateInconsistencies, runReconciliation } from "../reconcile-task-state-consistency.mjs";

function createStore(tasks) {
  const state = new Map(tasks.map((task) => [task.id, { ...task }]));
  const calls = { moveTask: 0, logEntry: 0 };

  return {
    calls,
    async listTasks() {
      return Array.from(state.values()).map((task) => ({ ...task }));
    },
    async moveTask(id, toColumn) {
      calls.moveTask += 1;
      const task = state.get(id);
      assert.ok(task);
      assert.equal(toColumn, "done");
      if (task.column === "done") {
        task.status = undefined;
        task.error = undefined;
        task.worktree = undefined;
        task.blockedBy = undefined;
        task.recoveryRetryCount = undefined;
        task.nextRecoveryAt = undefined;
      }
      return { ...task };
    },
    async logEntry(id, action, outcome) {
      calls.logEntry += 1;
      assert.equal(action, "FN-4000 reconciliation");
      assert.match(outcome, /FN-4000 reconciliation/);
      return { id };
    },
    getTask(id) {
      return state.get(id);
    },
  };
}

test("detects known bad done/failed fixture", () => {
  const issues = findTaskStateInconsistencies({
    id: "FN-X",
    column: "done",
    status: "failed",
    error: "oops",
    worktree: "wt",
  });

  assert.deepEqual(issues, [
    "done-task-has-transient-failure-state",
    "failed-status-outside-in-review",
  ]);
});

test("dry-run reports inconsistency without mutating", async () => {
  const store = createStore([
    { id: "FN-1", column: "done", status: "failed", error: "bad" },
    { id: "FN-2", column: "in-review", status: "failed" },
  ]);

  const result = await runReconciliation({ store, dryRun: true });

  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].taskId, "FN-1");
  assert.equal(store.calls.moveTask, 0);
  assert.equal(store.calls.logEntry, 0);
  assert.equal(store.getTask("FN-1").status, "failed");
});

test("apply reconciles done task and emits exactly one note", async () => {
  const store = createStore([
    {
      id: "FN-3990",
      column: "done",
      status: "failed",
      error: "stale",
      worktree: "worktrees/old",
      blockedBy: "FN-1",
      recoveryRetryCount: 2,
      nextRecoveryAt: "2026-05-11T00:00:00.000Z",
    },
  ]);

  const result = await runReconciliation({
    store,
    dryRun: false,
    noteByTaskId: {
      "FN-3990": "FN-4000 reconciliation: custom note",
    },
  });

  assert.equal(result.findings.length, 1);
  assert.equal(result.actions[0].action, "reconciled");
  assert.equal(store.calls.moveTask, 1);
  assert.equal(store.calls.logEntry, 1);

  const task = store.getTask("FN-3990");
  assert.equal(task.status, undefined);
  assert.equal(task.error, undefined);
  assert.equal(task.worktree, undefined);
  assert.equal(task.blockedBy, undefined);
  assert.equal(task.recoveryRetryCount, undefined);
  assert.equal(task.nextRecoveryAt, undefined);
});
