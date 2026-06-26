---
"@runfusion/fusion": patch
---

summary: Fusion co-author attribution now lands reliably on every commit it makes.
category: fix
dev: Inject the `Co-authored-by` trailer deterministically via the worktree commit-msg hook and the merger-ai `ensureCommitTaskMetadata` backfill (gated by `commitAuthorEnabled`), instead of relying on the agent appending it from the prompt.
