---
"@fusion/engine": minor
---

feat(merger): scope pnpm verification to changed packages and short-circuit out-of-scope fix loop

In a pnpm workspace, inferDefaultTestCommand now derives the set of packages touched by the branch diff and emits `pnpm --filter "<pkg>...^" test` instead of `pnpm test`. This prevents flakes in unrelated packages from blocking merges. When git context is unavailable or changes are root-only, the command falls back to the unscoped `pnpm test`.

When the in-merge fix agent makes no changes and all failing test files are outside the branch's diff, the merger now marks the task `status: "failed"` immediately with a clear "out-of-scope flake" message rather than retrying into the limbo-recovery cycle.
