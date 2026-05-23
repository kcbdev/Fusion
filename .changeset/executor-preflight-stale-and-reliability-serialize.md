---
"@runfusion/fusion": minor
---

feat(executor+engine-tests): preflight premise-stale exit and serialize reliability-interactions

- Executor: teach the system prompt a Preflight escape hatch. When Step 0 reproduces the issue described in PROMPT.md and finds the work is already done (HEAD matches the desired state), the agent now marks Step 0 done, marks remaining steps `skipped`, and calls `fn_task_done` with a `PREMISE STALE: …` summary. Skipped steps already pass `evaluateTaskDoneRefusal`, and the merger's empty-own-diff fast-path auto-finalizes the zero-diff branch — no new tool or refusal class is needed. This stops the executor from looping through plan/review/test/doc when PROMPT.md is out of sync with HEAD (the failure mode that exhausted FN-5521 across four worktrees).

- Engine vitest: split `packages/engine/vitest.config.ts` into two projects. `engine-default` keeps the full-parallelism layout for the bulk of the suite; `engine-reliability` scopes `src/__tests__/reliability-interactions/**` to `poolOptions.threads.singleThread: true` so the contention-sensitive event-ordering assertions (e.g. `merge-reuse-task-worktree`'s newest-first audit ordering check) no longer flake under workspace-concurrent merge-gate runs. Within-file order was already linear; this only removes inter-file parallelism for ~99 files that always shared a single git/SQLite contention surface.
