---
"@runfusion/fusion": minor
---

Fusion now supports an optional integration with the [worktrunk](https://github.com/max-sixty/worktrunk) CLI for per-task worktree management. It is off by default and can be enabled with `worktrunk.enabled` (global with project overrides).

When enabled, Fusion delegates worktree create/sync/prune/remove operations to worktrunk and adopts worktrunk’s directory layout. You can set `worktrunk.binaryPath` to use a specific binary, or rely on auto-install on first use (gated by the `network_api` action gate).

`worktrunk.onFailure` defaults to `"fail"` (pause the task on a worktrunk error), with opt-in `"fallback-native"` if you want Fusion to fall back to native worktree handling. When `worktrunk.enabled = true`, worktrunk layout takes precedence and `worktreesDir` is ignored.
