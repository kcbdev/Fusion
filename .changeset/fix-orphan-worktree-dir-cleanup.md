---
"@runfusion/fusion": patch
---

Fix worktree-creation failures (and the `Workflow graph terminated with failure at node 'execute'` they surface as) caused by leaked orphan worktree directories.

A directory under `.worktrees/` that survives with a *dangling* `.git` pointer — present on disk, but the `.git/worktrees/<name>` admin entry it references is gone — is invisible to `git worktree list` and untouched by `git worktree prune`, yet collides with a freshly generated worktree name. When the executor then tries to clean up the "conflict", `git worktree remove --force` fails with `is not a working tree` and the whole `execute` node fails after 3 attempts.

- **On-demand recovery (`executor.ts`):** the FN-4813 stale-conflict recovery now also treats `is not a working tree` and `ENOENT` (not just `validation failed, cannot remove working tree`) as "no live worktree at this path" — it prunes any admin entry, force-removes the leftover directory, and proceeds with fresh worktree creation instead of failing.
- **Leak prevention (`worktree-pool.ts`):** `reapOrphanWorktrees` previously skipped any dir on the mere *presence* of a `.git` file ("may be partially registered"), contradicting its own documented invariant. It now resolves the `.git` pointer and only skips when the gitdir target actually exists; a dangling pointer is reaped like any other half-initialized orphan, so these directories no longer accumulate across runs.
