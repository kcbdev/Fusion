---
"@runfusion/fusion": patch
---

summary: Plan Review now backs off and pauses on provider rate limits instead of retrying every 30s for hours.
category: fix
dev: runPlanReviewBeforeExecution fires usageLimitPauser.onUsageLimitHit for usage-limit reviewer failures (the inline reviewStep catch hid them from triage's own handler) and re-parks via computeRecoveryDecision (60s/120s/240s, terminalizing at MAX_RECOVERY_RETRIES) instead of a fixed 30s nextRecoveryAt. The borrowed recoveryRetryCount budget is cleared on any real verdict. RetryStormError gains an optional cause, surfaced as underlyingError in serializeRetryStormError, so the cap no longer masks the real error.
