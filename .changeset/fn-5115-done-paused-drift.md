---
"@runfusion/fusion": patch
---

Tasks moved to done no longer retain stale paused metadata, and `fn task list`
output suppresses the `(paused)` suffix for terminal (done/archived) tasks. A
one-shot startup backfill repairs already-drifted rows.
