---
"@runfusion/fusion": minor
---

Add a General setting (`ephemeralAgentsEnabled`, default true) to toggle ephemeral task-worker agent usage. When disabled, the scheduler auto-assigns every dispatchable task to a permanent executor based on the agent reporting chain and refuses to spawn `executor-FN-XXXX` workers.
