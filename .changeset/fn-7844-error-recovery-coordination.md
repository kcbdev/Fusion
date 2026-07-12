---
"@runfusion/fusion": patch
---

summary: Coordinate durable-agent error recovery across heartbeat and self-healing.
category: fix
dev: Reconciles heartbeatErrorRecovery with recoverOrphanedAgents so timer and self-healing paths share one retry budget, use consistent transient/operator-actionable eligibility, and emit a source-discriminated audit surface (FN-7844).
