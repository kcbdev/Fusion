---
"@runfusion/fusion": patch
---

Widen restart-recovery missing-worktree classification so self-healing also recovers `incomplete worktree` and `unregistered git worktree` session-start failures, matching existing handling for `missing worktree` failures.
