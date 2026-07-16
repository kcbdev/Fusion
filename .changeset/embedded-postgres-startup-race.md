---
"@runfusion/fusion": patch
---

summary: Starting a second Fusion process no longer fails with a Postgres lock-file error.
category: fix
dev: `EmbeddedPostgresLifecycle.start()` wraps the start path in a try/catch; on failure it re-reads `postmaster.pid` via `isAlreadyRunning()` and, when a live instance exists, joins it (`ownsProcess=false`) instead of surfacing the expected lock collision. Closes the window between the preflight singleton check and `pg.start()` where a competing process can create the lock. Non-`isAlreadyRunning` failures still rethrow unchanged.
