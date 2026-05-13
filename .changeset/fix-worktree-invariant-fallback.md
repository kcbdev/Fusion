---
"@runfusion/fusion": patch
---

Fix executor worktree invariant handling so restart and stale-session recovery paths create fresh sessions correctly without tripping false liveness failures.
