---
"@runfusion/fusion": patch
---

summary: Stop recording advisory "merger awaiting-confirmation" planner interventions that never block auto-merge.
category: fix
dev: decidePlannerRecovery now returns action "none" for merger/pull-request stages when autoMergeWillProceed === true; the genuine human-approval (false) and neutral (undefined) confirmation paths are unchanged (FN-7840).
