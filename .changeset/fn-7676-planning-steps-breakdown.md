---
"@runfusion/fusion": patch
---

summary: Task cards no longer show the steps breakdown while in the Planning column.
category: fix
dev: TaskCard `showProgressSection` now excludes the `triage` column, matching ListView; the breakdown appears once a task leaves Planning.
