---
"@fusion/engine": patch
---

fix(merger): refuse to finalize a task as no-op when modifiedFiles is non-empty

Third root-cause fix for tasks marked Done with no commit on main (the first
two — sibling-branch merge target + grep mis-attribution — landed in the
previous commit). When the executor produced edits but the squash didn't
land them as a commit (uncommitted in the worktree, squashed against the
wrong branch, branch dropped by reuse-handoff churn, etc.), the merger's
`classifyOwnedLandedEvidence` would return `proven-no-op` or
`no-changes-finalized` and both `aiMergeTask` and `recoverNoOpReviewTasks`
would happily move the task to Done while clearing `modifiedFiles` to `[]`
— silently destroying the audit trail of what was lost.

Both call sites now gate the no-op finalize on `task.modifiedFiles.length`:
if the task claims work was done but no commit landed, move the task back
to `todo` with progress preserved and emit a new
`task:finalize-lost-work-blocked` audit event. The next executor run
re-attempts the work; the operator sees the audit event in the run-audit
timeline.

The post-hoc `reconcileDoneTaskIntegrity` path is intentionally NOT gated —
it cleans up tasks that are already in Done (legacy state), which is
out-of-scope for the lost-work prevention. This matters: 9 lost-work tasks
were already in this state at sweep time (FN-5441, FN-5446, FN-5487,
FN-5490, FN-5517, FN-5526, FN-5539, FN-5540, FN-5542) and need to be
re-spec'd as fresh tasks rather than auto-reconciled. See
`docs/incidents/2026-05-23-lost-work-tasks.md` for the per-task catalog.
