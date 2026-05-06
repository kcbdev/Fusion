---
"@fusion/engine": patch
---

Fix agents stuck in `state="running"` after a missed-heartbeat termination.

The unresponsive-agent recovery path disposed the session and called `pauseAgent`, but never explicitly ended the run via `completeRun` — relying on the in-flight execution to self-complete via its catch handler, which doesn't happen when the run is genuinely hung. The run record could still be terminated through other paths (safety-net or supersede-on-startRun), but those bypass the agent-state transition, leaving the agent permanently displayed as "running" with no active run.

Two fixes:

- `recoverUnresponsiveAgent` now calls `completeRun(..., status: "terminated")` so the canonical state transition runs alongside the existing `pauseAgent`/`resumeAgent` sequence.
- `reconcileOrphanedRunningAgents` is broadened to also catch agents with stale `lastHeartbeatAt` (> 3× timeout) that aren't in the in-memory tracked set, terminating their stale run record. It now runs every poll instead of only at monitor start, so any pre-existing stuck rows from older versions self-heal within one poll interval after upgrade.
