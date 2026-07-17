---
"@runfusion/fusion": patch
---

summary: The overseer eye badge no longer appears on in-progress/in-review tasks when oversight is off.
category: fix
dev: pollPlannerOverseer now clears retained PlannerOverseerMonitor observations (plus recovery/advisor runtime) when a task's effective plannerOversightLevel resolves to "off", so getPlannerOverseerRuntimeSnapshot returns null and TaskCard omits the Eye badge; TaskCard also guards on oversightLevel !== "off".
