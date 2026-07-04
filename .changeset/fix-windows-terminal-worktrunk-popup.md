---
"@runfusion/fusion": patch
---

summary: Stop Windows Terminal version dialogs from popping up when opening the dashboard or Settings on Windows.
category: fix
dev: Root cause was the worktrunk integration, not the embedded terminal: worktrunk's CLI is named `wt`, which collides with Windows Terminal (`wt.exe`) on PATH, so probing it with `wt --version` launched Windows Terminal. Fixed by (1) `useWorktrunkInstallStatus` only auto-fetching `/api/worktrunk/status` when the integration is enabled (user opt-in) instead of on every Settings/dashboard mount, and (2) an engine-level guard in `probeWorktrunk` that refuses to exec a resolved `wt` that is the Windows Terminal alias (under `WindowsApps` / a `WindowsTerminal` package dir), covering all resolution surfaces.
