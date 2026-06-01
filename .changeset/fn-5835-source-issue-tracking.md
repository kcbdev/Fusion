---
"@runfusion/fusion": patch
---

Reuse imported GitHub source issues as task tracking links when GitHub tracking is enabled, instead of creating a duplicate issue. Tasks imported from GitHub now link their existing `sourceIssue` (when valid) as `githubTracking.issue` with no GitHub auth or issue creation call required.
