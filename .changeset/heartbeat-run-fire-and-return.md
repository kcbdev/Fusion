---
"@runfusion/fusion": patch
---

Manual heartbeat runs (POST /api/agents/:id/runs) now respond as soon
as the run record is created instead of blocking on the full
executeHeartbeat call. Long-running heartbeats no longer cause the
dashboard to surface "Failed to start heartbeat run: load failed" when
the client socket times out before the run completes.
