---
"@runfusion/fusion": patch
---

summary: Stuck re-queue no longer loses uncommitted work while keeping steps marked complete.
category: fix
dev: Reconciles lost-work steps before worktree removal across all three executor stuck-requeue paths; corrects the preserveProgressOnStuckRequeue docstring.
