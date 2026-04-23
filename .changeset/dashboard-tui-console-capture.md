---
"@runfusion/fusion": patch
---

Dashboard TUI now surfaces engine log output in the Logs tab. Previously, the engine's `createLogger()` writes (scheduler, executor, triage, merger, PR monitor, heartbeat, etc.) went straight to `console.error` and were rendered beneath the alt-screen TUI — effectively invisible. `DashboardLogSink.captureConsole()` now intercepts `console.log/warn/error` while the TUI is running and routes each line into the ring buffer, parsing a leading `[prefix]` tag so entries carry the subsystem prefix. Originals are restored on TUI shutdown.
