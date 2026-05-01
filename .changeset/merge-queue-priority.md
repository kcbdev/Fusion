---
"@runfusion/fusion": patch
---

Apply task priority across all Fusion scheduling paths so urgent work overtakes older low-priority work — including the merge queue, which previously merged tasks strictly FIFO.

- The auto-merge queue now picks the highest-priority eligible task each iteration (`urgent → high → normal → low`, then `createdAt` ASC, then id ASC). Manual `onMerge` resolvers still run before auto-merges so awaited callers aren't starved.
- Startup, periodic, global-unpause, and engine-unpause sweeps now sort their `listTasks` result by priority before enqueueing, so the first task picked up by `drainMergeQueue`'s single-item fast path is the highest-priority eligible one rather than the oldest. All four sweeps share a new `enqueueEligibleInReviewTasks` helper.
- Hardened the picker against concurrent queue mutation: it now re-locates the chosen task via `indexOf` after awaiting `getTask`, so a `stop()` clear or pause-handler removal that lands during the await can't splice out the wrong sibling. Drain and picker both re-check `shuttingDown` after the awaits to avoid starting a merge whose queue entry was already cleared.
- Triage and todo→in-progress scheduling already used the shared `sortTasksByPriorityThenAgeAndId` comparator and continue to apply dependency, overlap, and worktree constraints after the priority sort.
