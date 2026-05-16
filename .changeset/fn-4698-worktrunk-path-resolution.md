---
"@runfusion/fusion": patch
---

Reconcile worktrunk backend path contract: resolve the actual worktree
path via `git worktree list --porcelain` after `wt switch --create`
instead of assuming worktrunk uses Fusion's `.worktrees/<task-id>`
layout. Fixes silent `task.worktree` drift on worktrunk-enabled
projects.
