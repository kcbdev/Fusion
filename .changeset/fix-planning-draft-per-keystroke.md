---
"@runfusion/fusion": patch
---

summary: Planning mode no longer creates a new draft for every character you type.
category: fix
dev: PlanningModeModal's initial-plan textarea gated duplicate createPlanningDraft calls only on draftSessionIdRef, which is set after the create round-trip resolves; keystrokes during an in-flight create each spawned a fresh draft. A synchronous draftCreateInFlightRef sentinel now suppresses concurrent creates and is cleared on failure so a later keystroke can retry.
