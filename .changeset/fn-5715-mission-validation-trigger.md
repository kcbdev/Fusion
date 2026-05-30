---
"@runfusion/fusion": patch
---

Fix mission assertion-validation trigger gaps so mission-linked tasks reaching done no longer bypass validator execution.

Assertion-linked features now stay completion-gated until validator pass, and startup recovery replays implementing features whose linked tasks are already done/archived but still lack a passing validator status.
