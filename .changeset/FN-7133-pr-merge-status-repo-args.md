---
"@runfusion/fusion": patch
---

summary: Fix PR-mode auto-merge failing with "error connecting to <branch>".
category: fix
dev: processPullRequestMergeTask now resolves owner/repo via getCurrentRepo(cwd) and passes (owner, repo, number) to getPrMergeStatus at all three call sites (shared-group, per-task, retry); the local GitHubOperations interface param names corrected from base/head to owner/repo. FN-7133.
