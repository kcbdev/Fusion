---
"@runfusion/fusion": patch
---

Dashboard no longer calls the GitHub API on every board load to refresh PR/issue/tracking-issue status. Cards now render from persisted task state (`prInfo`, `issueInfo`, `githubTracking.issue`) and live WebSocket badge updates, while explicit refresh via `POST /api/github/batch-status` remains available.
