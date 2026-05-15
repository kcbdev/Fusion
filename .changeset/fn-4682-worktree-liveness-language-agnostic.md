---
"@runfusion/fusion": patch
---

Make task worktree liveness checks language-agnostic by removing the root `package.json` requirement. Worktrees are now considered usable based on git integrity (`.git` presence, registration, and `git rev-parse --is-inside-work-tree`), fixing false `not_usable_task_worktree` failures in Python, polyglot, nested-manifest, and empty repositories.
