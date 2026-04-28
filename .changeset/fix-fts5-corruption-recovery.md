---
"@runfusion/fusion": patch
---

Recover automatically from SQLite FTS5 corruption during task upserts by rebuilding the `tasks_fts` index and retrying once, and add FTS5 integrity checks to database health monitoring.