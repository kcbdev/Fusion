---
"@runfusion/fusion": patch
---

Reset a task's stuck-kill streak on genuine forward progress. `stuckKillCount` was a lifetime counter — incremented by self-healing on each stuck-kill and cleared only by a manual retry — so a long, genuinely-progressing task could be terminalized by accumulation toward the stuck-kill budget. It now resets when a step reaches a terminal forward status (done/skipped), so only consecutive no-progress stalls count toward the budget.
