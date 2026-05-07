---
"@runfusion/fusion": patch
---

Fix cluster-backed task creation to automatically recover when a reserved `FN-*` ID overlaps an existing task. The allocator and task-create route now advance to the next available ID with bounded retry behavior while preserving reservation commit/abort safety guarantees.
