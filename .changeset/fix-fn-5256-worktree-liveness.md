---
"@runfusion/fusion": patch
---

fix(FN-5256): harden three independent code paths that were losing live task worktrees mid-execution and producing `wrong_toplevel` errors.

- Executor stale-self-owned classifier (`reconcileSelfOwnedActiveSessionForRemoval`) now requires two additional signals before dropping a same-task registry entry: a process-active probe (`executingTaskLock.has`) and a minimum-idle window (default 5s) since the entry was registered. This closes the pause/resume race where the new executor cycle hadn't repopulated `activeWorktrees` yet and the old session's registry entry was reaped under a still-live shell. The post-throw reconcile in `removeOwnWorktreeWithReconcile` and the `removeWorktree` defensive reconcile in `worktree-backend.ts` route through the same hardened path.

- Pause-before-park now synchronously awaits agent/step/workflow session disposal via a new `awaitAbortInFlightTaskWork` method, so by the time `parkTaskAfterWorkflowStepPause` calls `moveTask("todo")` the spawned shells are already reaped and any fast re-dispatch sees a clean slate. The user-initiated pause handler on `task:updated` was collapsed onto the same await path for the same reason.

- Self-healing `reconcileTaskWorktreeMetadata` now normalizes both sides via `realpathSync` (with ENOENT fallback) before comparing the task worktree against the registered set, fixing the macOS `/private/var/...` false-stale flag. It additionally refuses to clear `worktree`/`branch` metadata for in-progress or in-review tasks — those go through `task:auto-recover-worktree-metadata-skipped-active` audit events and leave executor-level recovery in charge.
