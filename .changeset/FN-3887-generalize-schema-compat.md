---
"@runfusion/fusion": patch
---

Generalize the SQLite schema self-heal pass to reconcile missing columns for every critical table on `Database.init()`, not just `tasks`.

This prevents legacy or drifted databases from hitting `no such column: <X>` regressions after new column additions, and adds architecture lint coverage to ensure new `CREATE TABLE` definitions are always included in schema-compatibility coverage.
