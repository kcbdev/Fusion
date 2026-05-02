---
"@runfusion/fusion": patch
---

Run the auto-backup automation in-process instead of shelling out to whatever fusion binary happens to be on `PATH`. The cron and routine runners now intercept commands matching `fn backup`, `fusion backup`, or `npx runfusion.ai backup` and call `runBackupCommand` directly through the engine's already-open `TaskStore`. This stops the auto-backup from launching an outdated globally-installed fusion binary that could re-introduce already-fixed bugs (most recently the `pluginStore` rootDir mistake that created a stray `.fusion/.fusion/` directory each time the schedule fired). New backup automations are also written with the simpler `fn backup --create` command — existing schedules using the old `npx runfusion.ai` form keep working because both forms hit the same in-process interception.
