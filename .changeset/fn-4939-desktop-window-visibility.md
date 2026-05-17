---
"@runfusion/fusion": patch
---

Fix desktop app launches on macOS where the process starts but no visible window appears. Window position restore now validates saved coordinates against connected display work areas and drops off-screen positions, and startup explicitly show/focuses the window with a ready-to-show path plus fallback timer.