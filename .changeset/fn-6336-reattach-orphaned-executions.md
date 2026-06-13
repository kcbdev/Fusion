---
"@runfusion/fusion": patch
---

Self-healing now automatically re-dispatches an assigned in-progress task when its durable agent loses both the heartbeat run and active execution session, preventing the task from stranding until the next engine restart.
