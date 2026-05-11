---
"@runfusion/fusion": patch
---

Harden task ID allocation so reserved/manual/distributed task creation cannot reuse an existing ID or overwrite live in-review tasks when legacy counters drift.
