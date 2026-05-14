---
"@runfusion/fusion": patch
---

Self-healing now auto-reclaims paused `branch-conflict-unrecoverable` tasks when the branch/worktree is self-owned, and orphaned `fusion/*` branches with unique commits are rescued as new triage tasks instead of force-deleted.
