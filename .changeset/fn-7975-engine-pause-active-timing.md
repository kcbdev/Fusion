---
"@runfusion/fusion": patch
---

summary: Exclude long engine pauses from in-progress task execution time.
category: fix
dev: Reuses FN-7011 active-timing reconciliation on full Global/Engine unpause. Engine-pause time is excluded even if in-flight agents continue, matching restart behavior.
