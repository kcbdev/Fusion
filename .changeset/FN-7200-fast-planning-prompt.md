---
"@runfusion/fusion": minor
---

summary: Fast-mode tasks now plan with a lean, speed-first prompt routed through the workflow.
category: feature
dev: Replaces the verbose built-in `planning-fast` seam prompt (FAST_TRIAGE_PROMPT_TEXT) with a concise variant; resolution still prefers a workflow's `planning-fast` seam and falls back to the built-in.
