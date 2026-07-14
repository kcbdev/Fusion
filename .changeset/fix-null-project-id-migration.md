---
"@runfusion/fusion": patch
---

summary: Fix startup migration for legacy project rows whose project ID is null.
category: fix
dev: Bound SQLite cutovers now override nullable or stale source project IDs with the resolved registry identity.
