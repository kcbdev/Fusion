---
"@runfusion/fusion": patch
---

Fix merger subject derivation and add a race-rescue layer to the autostash.

The deterministic fallback now prefers the lowest-numbered `complete Step N` headline (or the oldest commit) over the most-recent commit, and the AI subject/body prompts weight by commit theme instead of file size — so a small token-cleanup fixup that touches a large file no longer hijacks the squash-merge subject.

The pre-merge autostash now re-snapshots the working tree after the primary stash is persisted but before `git reset --hard` runs, capturing any dirty paths that landed between the initial snapshot and the destructive wipe (concurrent dev edits during a long merger run, parallel merger runs interleaving, or late test/build artifacts) into a separate `race-rescue` stash so they're recoverable from `git stash list`.

Adds an advisory `.git/.fusion-merger-active.json` written for the duration of each merger run (taskId, pid, hostname, startedAt) so dashboards / status lines / pre-Edit hooks can surface that `rootDir` is volatile. Not a lock — dev edits are never blocked. Race-rescue stashes are now also surfaced on the task feed via `store.logEntry` with the recovery command, instead of only appearing as a `mergerLog.warn`. `resetMergeWithWarn` now wraps each `git reset --merge` in a snapshot-before/after observer so any silent wipe of unrelated dirty paths emits an actionable warning instead of going unnoticed. Exports `readActiveMergerStatus(rootDir)` for consumers.
