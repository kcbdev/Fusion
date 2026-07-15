---
"@runfusion/fusion": patch
---

summary: Quiet repetitive scheduler hold-release and task-routing lines that flooded the engine log pane.
category: fix
dev: Adds `Logger.debug()` in `packages/engine/src/logger.ts`, gated per subsystem by `FUSION_DEBUG` (`1`/`true`/`all`/`*`, or a comma-separated prefix list). Demotes `Hold release for <id> deferred — no reservable slot` and local-only `Task <id> routed to node=local` to debug; remote routing stays at info. See `docs/diagnostics.md`.
