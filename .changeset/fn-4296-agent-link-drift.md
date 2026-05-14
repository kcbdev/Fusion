---
"@runfusion/fusion": patch
---

Engine reliability: durable agents no longer retain a stale Current Task pointer after the task moves to done/archived/todo/triage. A new task-move listener clears agent.taskId in real time, and the self-healing sweep recovers already-drifted records on startup and periodically.
