---
"@runfusion/fusion": patch
---

summary: Make task deletion return faster while cleanup continues in the background.
category: performance
dev: Defers branch cleanup and dashboard agent-binding release off the user-visible delete path.
