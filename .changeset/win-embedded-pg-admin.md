---
"@runfusion/fusion": patch
---

summary: Embedded Postgres now boots on Windows when Fusion runs elevated, fixing the Windows installer build.
category: fix
dev: On elevated Windows the postgres server is booted under a dedicated non-admin local user via Start-Process -Credential (packages/core embedded-lifecycle.ts + embedded-windows-admin.ts); initdb and the pg client still run as the launching process.
