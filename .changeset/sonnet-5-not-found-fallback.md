---
"@runfusion/fusion": patch
---

summary: Retry configured fallback models when a selected provider model returns a not-found error.
category: fix
dev: Classifies structured provider model 404 payloads, including Anthropic not_found_error, as model-selection failures.
