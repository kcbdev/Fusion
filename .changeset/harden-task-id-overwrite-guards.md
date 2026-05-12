---
"@runfusion/fusion": patch
---

Harden task creation so stale allocator state or colliding reservations fail safely instead of overwriting an existing task row or task directory.
