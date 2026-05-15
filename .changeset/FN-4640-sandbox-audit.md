---
"@runfusion/fusion": patch
---

Add `sandbox` run-audit domain with `sandbox:prepare`/`sandbox:run`/`sandbox:failure`/`sandbox:fallback` lifecycle events emitted from the engine's `SandboxBackend` wiring sites, and surface them through the dashboard's run-audit API (filter parser, normalized event domain, timeline `auditByDomain.sandbox` bucket).
