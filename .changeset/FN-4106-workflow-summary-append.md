---
"@runfusion/fusion": patch
---

fn_task_done now appends to the existing task summary when a workflow step
forces a rerun, instead of overwriting the original completion summary.
