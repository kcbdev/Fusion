---
"@runfusion/fusion": minor
---

summary: Workflow steps like Code Review and Browser Verification can set their own max fix revisions.
category: feature
dev: Adds optional `maxRevisions` (number | "unbounded") to optional-group workflow nodes, resolved by `resolveOptionalStepRevisionBudget` and threaded through `requestPreMergeOptionalStepFix` plus `recoverReviewTasksWithFailedPreMergeSteps`. Overrides global `maxPostReviewFixes`; absent preserves prior behavior. The Workflow Node Editor authors it with a number input and Unbounded toggle.
