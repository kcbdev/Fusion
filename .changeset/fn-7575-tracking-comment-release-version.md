---
"@runfusion/fusion": patch
---

summary: Fusion self-repo issues now actually show the target release version when a task closes.
category: fix
dev: FN-7575 added the release lines to `GitHubIssueCommentService`, which is gated on the `githubCommentOnDone` setting (default false, no Settings UI) and so never fired. `GitHubTrackingCommentService` is the surface that posts the "✅ Done —" comments. The version logic moved to a shared `fusion-release-version.ts` and now applies to all four done-comment surfaces (GitHub/GitLab × tracking/issue). Lines join `optionalLines` so they count against `DONE_COMMENT_MAX_LENGTH`; GitLab self-repo matching uses `item.projectPath`, since the resolved target prefers the numeric `projectId`.
