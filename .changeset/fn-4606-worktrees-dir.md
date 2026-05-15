---
"@runfusion/fusion": minor
---

Add `worktreesDir` project setting to place task worktrees outside the project root. Supports absolute paths, paths relative to the project root, `~` expansion, and the `{repo}` token. Defaults to the existing `<projectRoot>/.worktrees` behavior when unset.
