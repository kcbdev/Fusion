---
"@runfusion/fusion": minor
---

Make the built-in compound-engineering workflow run the CE way end-to-end:

- **Execute** stage invokes the `compound-engineering:ce-work` skill in coding mode instead of the generic executor prompt.
- **Merge** stage adds `ce-commit-push-pr` and `ce-resolve-pr-feedback` skill steps (CE owns commit/push/PR + feedback; Fusion's merge seam still owns the board-state merge). The plugin now bundles `ce-commit`, `ce-commit-push-pr`, and `ce-resolve-pr-feedback`.
- **Planning questions reach a human:** workflow-step sessions carry a `FUSION_WORKFLOW_STEP` signal; in that mode the CE skills emit an await-input sentinel instead of calling a blocking tool with no listener. The executor parks the task `awaiting-user-input` with the question, and a new task-card **"Answer questions"** button opens the workflow tab where the existing input banner captures the answer and resumes the step.
- **Subagents work in workflow steps:** `fn_spawn_agent` gains an optional `systemPromptOverride`; the plugin installs the 43 `ce-*` persona definitions plugin-locally and exposes their directory via `FUSION_CE_AGENTS_DIR`, so the CE skills read a persona def and spawn it as a real subagent (falling back to inline single-agent work when unavailable).
