---
"@gsxdsm/fusion": patch
---

Canonical model lane hierarchy resolution: Engine and dashboard API entry points now consistently resolve AI models using the same precedence order (per-task override → project override → global lane → default). This eliminates "same task, different model" outcomes across executor, triage, reviewer, and dashboard helper routes.
