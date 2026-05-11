#!/usr/bin/env node
import process from "node:process";

const DEFAULT_NOTE = "FN-4000 reconciliation: cleared stale transient failure state using TaskStore done-normalization so database and task JSON remain synchronized.";

export function findTaskStateInconsistencies(task) {
  const findings = [];
  const hasDoneTransient = task.column === "done" && (
    task.status === "failed"
    || Boolean(task.error)
    || Boolean(task.worktree)
    || Boolean(task.blockedBy)
    || typeof task.recoveryRetryCount === "number"
    || Boolean(task.nextRecoveryAt)
  );

  if (hasDoneTransient) {
    findings.push("done-task-has-transient-failure-state");
  }

  if (task.status === "failed" && task.column !== "in-review") {
    findings.push("failed-status-outside-in-review");
  }

  return findings;
}

export async function runReconciliation({ store, dryRun = true, noteByTaskId = {} }) {
  const tasks = await store.listTasks({ includeArchived: false });
  const findings = [];
  const actions = [];

  for (const task of tasks) {
    const issues = findTaskStateInconsistencies(task);
    if (issues.length === 0) continue;

    findings.push({ taskId: task.id, column: task.column, status: task.status ?? null, issues });

    if (dryRun) {
      actions.push({ taskId: task.id, action: "would-reconcile", issues });
      continue;
    }

    if (task.column === "done") {
      await store.moveTask(task.id, "done");
      const note = noteByTaskId[task.id] ?? DEFAULT_NOTE;
      await store.logEntry(task.id, "FN-4000 reconciliation", note);
      actions.push({ taskId: task.id, action: "reconciled", issues });
      continue;
    }

    actions.push({ taskId: task.id, action: "flagged-no-safe-auto-fix", issues });
  }

  return { findings, actions };
}

function readFlagValue(argv, flag) {
  const index = argv.indexOf(flag);
  if (index < 0) return undefined;
  return argv[index + 1];
}

export async function main(argv = process.argv.slice(2), deps = {}) {
  const dryRun = !argv.includes("--apply");
  const projectDir = readFlagValue(argv, "--project-dir") ?? process.cwd();
  const store = deps.store ?? (await (async () => {
    const { TaskStore } = await import("../packages/core/dist/index.js");
    const taskStore = new TaskStore(projectDir);
    await taskStore.init();
    return taskStore;
  })());

  const noteByTaskId = {
    "FN-3990": "FN-4000 reconciliation: cleared stale failed-state metadata after shipped lineage work landed in b89471aa5 and dashboard/doc follow-through completed in FN-3998.",
  };

  const result = await runReconciliation({ store, dryRun, noteByTaskId });
  console.log(JSON.stringify({ dryRun, ...result }, null, 2));
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
