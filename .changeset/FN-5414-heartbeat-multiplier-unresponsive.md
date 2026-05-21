---
"@runfusion/fusion": patch
---

Apply `heartbeatMultiplier` to heartbeat unresponsive timeout calculations in `HeartbeatMonitor`.

When heartbeat speed is slowed (for example `heartbeatMultiplier=2`), unresponsive detection/recovery and orphaned-running reconciliation now use the correspondingly scaled timeout base, preventing false unresponsive recovery for expected slower cadence. Dashboard health classifier behavior is unchanged.
