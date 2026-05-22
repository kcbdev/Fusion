---
"@runfusion/fusion": patch
---

fix(engine): prevent worktree-pool branch creation from inheriting a previous occupant's tip, and auto-reanchor branches that already inherited foreign commits.

- `WorktreePool.prepareForTask` now rejects empty/`HEAD` base values and verifies post-detach HEAD matches the resolved base SHA before creating the branch. This closes the FN-5432 / FN-5255 contamination pattern where recycled worktrees branched from a stale HEAD (reflog: `branch: Created from HEAD`) and pinned the new task's tip to the previous task's commit.

- `SelfHealingManager` now attempts a foreign-only contamination reanchor before pausing a task with `branch-conflict-unrecoverable`. When the task's branch carries only foreign commits (no own work), the branch is reset back to its base via the existing `recoverForeignOnlyContamination` path instead of stranding the task for human adjudication.
