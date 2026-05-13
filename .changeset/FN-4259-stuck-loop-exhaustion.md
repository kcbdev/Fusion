---
"@runfusion/fusion": patch
---

Add a deterministic terminal contract for stuck-loop retry exhaustion. Exhausted tasks are marked failed with a `STUCK_LOOP_EXHAUSTED:` error prefix, receive a final operator guidance log entry, and are untracked by the stuck detector so automatic kill/requeue churn does not continue until the task is manually recovered.
