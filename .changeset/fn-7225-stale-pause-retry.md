---
"@runfusion/fusion": patch
---

summary: Prevent stale pause state from mislabeling workflow retries as engine pauses.
category: fix
dev: Clears executor pause-abort provenance on fresh dispatch, Plan Review replan, and manual retry.
