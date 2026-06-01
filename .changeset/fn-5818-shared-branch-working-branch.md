---
"@runfusion/fusion": patch
---

Fix shared branch-group execution to always derive per-task working branches (`fusion/<task-id>`) for checkout/worktree operations while keeping the branch-group branch as the merge target.
