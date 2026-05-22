---
"@runfusion/fusion": patch
---

Engine reliability: auto-recover merge handoff from HEAD drift when the branch ref is authoritative.

- `acquireReuseHandoff` previously refused outright with `head-branch-mismatch / unexpected-branch` whenever the worktree's HEAD pointed at anything other than `fusion/<id>` (detached, recycled to `main`, on a sibling branch). The existing case-mismatch autocorrect did not cover these states, leaving FN-5339-class tasks wedged in review even though their branch ref still held a clean, task-attributed lineage.
- New `isBranchAuthoritativeForTask` helper (in `branch-conflicts.ts`) confirms the expected branch ref exists, its tip carries the `Fusion-Task-Id: <id>` trailer, and the `base..branch` range has no foreign FN-attributed commits.
- When that probe passes, the handoff now performs a plain `git checkout <branch>` (not `-B`, which would clobber the ref) inside the already-asserted-clean worktree, re-reads HEAD, and emits a `branch:auto-reattach-authoritative` audit. Refusal still fires unchanged when the branch ref itself is missing, missing a trailer, or contaminated — so the FN-5363 strict-lease and foreign-commit protections remain authoritative.
