---
"@runfusion/fusion": minor
---

Branch-group promotion now creates a single real GitHub PR for the group integration branch when promoting a completed PR-mode group. The PR number/url/state are persisted on the branch group and promotion is idempotent — re-running never opens a second PR (an existing persisted or open PR is reused). The GitHub client is injected into the engine via the same option-callback seam as `processPullRequestMerge`, wired at the `fn daemon`, `fn dashboard`, and `fn serve` construction sites. PR creation only happens for eligible (completion-gated, auto-merge-allowed) groups, and a GitHub failure leaves the group recoverable rather than persisting a false PR state.
