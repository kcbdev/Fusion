---
"@runfusion/fusion": patch
---

Repair dropped spaces after sentence-ending punctuation in streamed agent responses (chat and agent logs) across all providers by applying the streaming-delta sentence-boundary fix at the shared engine delta chokepoints, not just the per-provider CLI bridges.
