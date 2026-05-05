---
"@runfusion/fusion": patch
---

Auto-toggle xterm mouse reporting in the dashboard TUI based on the focused panel. Default is now OFF so click-drag selection works by default (e.g. selecting the auth token straight off the System panel without needing `[c]`). Mouse reporting auto-enables when the user focuses a panel that consumes wheel events:

- Status mode: on while Logs is focused, off elsewhere
- Interactive views: on for Files / Git / Board (Board uses the wheel in the task-detail screen), off for Agents / Settings

`[M]` remains a manual override but the next focus change reapplies the auto policy. The controller's `start()` now honors the initial `mouseEnabled` value rather than unconditionally writing the SGR enable sequence at boot.
