---
"@fusion/engine": patch
"@fusion/core": patch
---

Fix pre-merge workflow steps stalling on tasks with no relevant changes (FN-3327 post-mortem).

- **`@fusion/engine`**: `executeWorkflowStep` now computes the diff scope (`git diff --name-only` plus `--shortstat` against `task.baseCommitSha`) before spawning the reviewer agent and injects a "Diff Scope" block into the system prompt. The block lists every file the task actually changed and adds explicit scoping rules: review only those files, and if none match the step's category respond immediately with a short approval line and stop. Without this, an open-ended review prompt (e.g. WS-005 "Frontend UX Design") would drift into pre-existing files matching the task description's keywords, exhaust the 360 s timeout, and trigger the auto-revive → re-finalize → re-fail loop that had FN-3327 wedged in `in-review`. Both git calls are best-effort; failures degrade to a "no modified files detected" notice rather than blocking the step.
- **`@fusion/core`**: The built-in `frontend-ux-design` workflow step template (WS-005) now opens with a FAST-BAIL rule telling the reviewer to inspect the Diff Scope first and return an immediate one-line approval when no UI/CSS/component files are present. New installs and freshly-materialized templates pick this up automatically; existing DB rows are unaffected but are still rescued by the executor-side scope injection above.
