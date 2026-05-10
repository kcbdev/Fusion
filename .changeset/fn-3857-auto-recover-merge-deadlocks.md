---
"@runfusion/fusion": patch
---

Add automatic recovery for board-level merge deadlocks by promoting retry-exhausted already-landed review tasks to done, clearing stale `blockedBy` references on todo tasks when blockers are terminal or deadlocked, and excluding paused in-review worktrees from scheduler overlap `activeScopes` so paused blockers cannot repeatedly re-stamp downstream tasks.
