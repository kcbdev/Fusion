---
"@runfusion/fusion": patch
---

summary: Workflow graph nodes now resume cleanly after engine pause-aborts.
category: fix
dev: Distinguishes engine-internal in-flight node aborts from genuine workflow node failures, re-enters the node through a bounded graph resume path, and emits a run-audit event for the recovery.
