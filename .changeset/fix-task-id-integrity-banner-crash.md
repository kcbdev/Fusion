---
"@runfusion/fusion": patch
---

Fix dashboard crash `undefined is not an object (evaluating 'taskIdIntegrity.status')` when the health response lacks `taskIdIntegrity` (e.g. older dashboard server). The banner gate in `App.tsx` now optional-chains `taskIdIntegrity` so the page renders cleanly when the field is missing.
