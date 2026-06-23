---
"@runfusion/fusion": patch
---

Graduate workflow columns and the workflow graph executor to the default runtime path.

Upgrade notes: stale persisted `experimentalFeatures.workflowColumns` and `experimentalFeatures.workflowGraphExecutor` values are ignored by the engine, so prior installs keep dispatching tasks through the workflow runtime after upgrade. `workflowInterpreterDualObserve` remains an internal diagnostic and defaults off.

If an upgraded project appears stalled, treat `todo` tasks with unmet dependencies, `paused`/`userPaused`, active checkout leases, unavailable assigned nodes, or file-scope overlap as intentionally parked. Eligible `todo` tasks without those blockers should be picked up by the workflow scheduler; eligible `in-progress` rows without a live executor are recovered through the normal orphan-resume/self-healing path. The old Experimental toggles are no longer a rollback switch; use a source rollback/downgrade to the previous release if the workflow runtime itself must be reverted.
