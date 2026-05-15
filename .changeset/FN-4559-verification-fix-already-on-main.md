---
"@runfusion/fusion": patch
---

Suppress false `verification fix finalize failed (fix produced no content)` failures when task content is already on main by adding a last-chance already-landed classification in merger finalize and a new self-healing sweep that recovers misbound in-review branch tips. This also avoids noisy Task Failed notifications for this recovered path and records dedicated audit events for both finalize and self-healing recovery flows.
