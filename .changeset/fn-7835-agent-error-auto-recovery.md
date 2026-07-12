---
"@runfusion/fusion": patch
---

summary: Agents now auto-clear error state and retry on their next heartbeat instead of getting stuck.
category: fix
dev: Heartbeat scheduler keeps transient, non-operator-actionable error-state durable agents timer-eligible; executeHeartbeat clears error (error→active, clears lastError) at run entry, bounded by MAX_HEARTBEAT_ERROR_RECOVERY_ATTEMPTS (settings-overridable). Operator-actionable errors stay parked; exhaustion pauses the agent with pauseReason "error-retry-exhausted"; a successful run resets the counter. Emits agent:auto-recover-error-state / agent:error-retry-exhausted run-audit events.
