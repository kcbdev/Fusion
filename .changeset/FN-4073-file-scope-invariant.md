---
"@runfusion/fusion": patch
---

Merger now refuses to land a squash whose staged diff has zero overlap with the
task's declared `## File Scope`. Tasks can opt out by setting
`task.scopeOverride = true` (with optional `task.scopeOverrideReason`).
Violating squashes leave the task in `in-review` with a structured agent-log
entry instead of silently shipping out-of-scope changes.
