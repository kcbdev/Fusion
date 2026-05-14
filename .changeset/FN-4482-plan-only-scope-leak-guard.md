---
"@runfusion/fusion": patch
---

Add executor-side scope-leak guard at fn_task_done for Plan-Only (Review Level 1) tasks. Off-scope uncommitted edits now produce a [scope-leak] activity-log entry (default warn) or refuse fn_task_done when planOnlyScopeLeakEnforcement="block". Respects task.scopeOverride and never blocks on git infrastructure failures.
