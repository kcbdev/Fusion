---
"@runfusion/fusion": patch
---

Harden post-merge audit deterministic short-circuit against HEAD drift by checking both the audited commit tree and task-branch tip tree against verification cache entries.
