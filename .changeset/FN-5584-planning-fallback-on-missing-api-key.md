---
"@runfusion/fusion": patch
---

Fix triage/executor not swapping to the configured planning fallback model when the primary provider's API key is missing (or returns 401/403/rate-limit). The top-level `promptWithFallback` now delegates to the rich session-attached path (which runs `isRetryableModelSelectionError` and `swapPromptSession`), with a WeakSet re-entry guard preserving the FN-4900 recursion fix.
