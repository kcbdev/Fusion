---
"@runfusion/fusion": patch
---

Fix Plan Mission With AI modal: stale goal text and unable to type in textarea. The persisted-goal restoration effect depended on `handleStartInterview`, which recreates on every keystroke via `missionGoal` — causing the effect to re-fire and overwrite user input with stale localStorage data on each character typed.
