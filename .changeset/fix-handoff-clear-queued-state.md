---
"@runfusion/fusion": patch
---

fix: clear scheduler-side `status='queued'`, `blockedBy`, and `overlapBlockedBy` when a task transitions into `in-review` so the merge gate is no longer permanently blocked by stale todo-dispatch markers.

Repro: a task that picked up `status='queued'` while waiting in `todo` (e.g. file-scope overlap with a higher-priority queued peer) and then completed and was handed off to `in-review` — directly via `handoffToReview` or indirectly via stranded-completed-todo recovery — would carry the queued flag into review. Every subsequent merge attempt failed with `Cannot merge <id>: task is marked 'queued'`, and the in-review stall surface kept re-firing `[no-worktree-no-merge-confirmed]` without progress. Ghost-review → todo → scheduler re-queue → stranded → in-review formed a steady-state loop.

Fix: `TaskStore.moveTaskInternal` now treats `queued`/`blockedBy`/`overlapBlockedBy` as todo-only dispatch state and scrubs them on every transition into `in-review`. Failed/awaiting-* statuses are unaffected.
