---
"@runfusion/fusion": patch
---

Fix worktree collisions when tasks are manually moved into in-progress.

Two related bugs caused two in-progress tasks to share a single
`.worktrees/<name>` directory:

1. The dashboard `POST /tasks/:id/move` route promoted tasks to
   in-progress without allocating a fresh worktree path, so a queued
   task carrying a stale `worktree` field from a prior
   `preserveResumeState` requeue could land in-progress on a directory
   already owned by another active task.

2. `TaskStore.moveTask({ preserveResumeState: true })` kept the
   worktree pointer on requeue. When the on-disk checkout was later
   removed or reassigned, the next dispatch could collide with a
   worktree the scheduler had since handed to another task.

Fixes:

- `moveTask` now releases the worktree pointer on every reopen-to-todo
  hop. The `branch` field is preserved so the next run reattaches via
  `git worktree add <path> <branch>` and resumes any committed
  progress. A new `preserveWorktree: true` option opts internal
  bounces (workflow-rerun) out of the release so listeners never see
  an interim `worktree=null` state.
- `moveTask` accepts an `allocateWorktree` callback that runs under a
  cross-task allocation lock in `TaskStore`, building `reservedNames`
  from a fresh `listTasks` snapshot so two concurrent moves cannot
  pick the same name.
- The manual-move route and the scheduler dispatch path both flow
  through the new allocator, sharing the lock.
- `planTaskWorktreePath` is exported from `@fusion/engine` for
  consumers that need to plan worktree paths the same way the
  scheduler does.
