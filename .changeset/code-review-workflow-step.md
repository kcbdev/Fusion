---
"@runfusion/fusion": minor
---

summary: Add a standard pre-merge Code Review step to the built-in coding workflows.
category: feature
dev: New always-on `code-review` prompt node (toolMode readonly, gateMode advisory, phase pre-merge) on the pre-merge success path (execute → browser-verification → code-review → review) of both the built-in coding and stepwise coding workflows. Runs for every coding task by default with no `enabledWorkflowSteps` gating; advisory so it does not change merge outcomes (operators can promote it to a blocking gate). Reuses the shared prompt-gate verdict machinery (no engine verification code). The `code-review` WORKFLOW_STEP_TEMPLATE is also available in the editor palette.
