---
"@runfusion/fusion": patch
---

Self-healing now auto-reclaims `fusion/<task-id>` branches that are still live-mapped to a worktree but have zero unique commits vs `main` by force-removing the stale worktree and deleting the branch, so retry can recreate a clean checkout without manual branch-recovery intervention.
