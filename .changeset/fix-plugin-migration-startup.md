---
"@runfusion/fusion": patch
---

summary: Prevent startup crashes while recovering plugins from retained SQLite data.
category: fix
dev: Runs the plugin bridge before switching PostgreSQL connections to the restricted runtime role.
