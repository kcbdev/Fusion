---
"@runfusion/fusion": patch
---

Reports Health Check now flags a direct report as stale only when its last heartbeat is older than `1.5 × heartbeatIntervalMs`, with a 5-minute minimum threshold floor for agents without a configured interval. This eliminates recurring false positives for long-cadence direct reports while preserving the existing fallback behavior.
