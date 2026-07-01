---
"@runfusion/fusion": patch
---

summary: Retry workflow merge-node pause aborts while merge review is active.
category: fix
dev: Treats transient in-review statuses such as reviewing/merging as safe for bounded merge retry.
