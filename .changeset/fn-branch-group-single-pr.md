---
"@runfusion/fusion": minor
---

Branch-group promotion now creates a single real GitHub PR for the group integration branch when promoting a completed PR-mode group. The PR number/url/state are persisted on the branch group and promotion is idempotent — re-running never opens a second PR (an existing persisted or open PR is reused). The GitHub client is injected into the engine via the same option-callback seam as `processPullRequestMerge`, wired at the `fn daemon`, `fn dashboard`, and `fn serve` construction sites. PR creation only happens for eligible (completion-gated, auto-merge-allowed) groups, and a GitHub failure leaves the group recoverable rather than persisting a false PR state.

The single managed group PR is now kept in sync through its terminal lifecycle: as additional members land, the PR body is rewritten with the latest member checklist and x/N completion (idempotent body rewrite — sync failures are non-fatal and retry on the next landing). When the persisted PR is closed or merged out-of-band on GitHub, the stored `prState` is reconciled rather than re-opened. Abandoning a group best-effort closes its GitHub PR and marks `prState` `closed` (or preserves `merged`). New injected `syncGroupPr` callback and dashboard `updatePr`/`closePr` GitHub-client helpers back this flow.
