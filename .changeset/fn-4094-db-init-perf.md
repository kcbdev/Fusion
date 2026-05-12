---
"@runfusion/fusion": patch
---

Optimize Database.init() schema-compatibility passes: cache per-table PRAGMA results within init and short-circuit unchanged-schema opens via a `schemaCompatFingerprint` in `__meta`. Reduces repeated `db.init()` wall time substantially without weakening the FN-3879/FN-3887/FN-3898 invariant that every declared column exists after init.
