---
"@runfusion/fusion": patch
---

Fix bootstrap-misbinding recovery when a Fusion worktree is already bound to its task branch at the target base SHA (no more `fatal: '<branch>' is already used by worktree` errors during re-anchor).
