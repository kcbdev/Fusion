---
"@fusion/engine": patch
---

feat(merger): auto-rehome FF-recoverable orphan commits during contamination recovery

Follow-up to the FF-only ref advance fix: contamination recovery now classifies a fourth bucket — `orphan-our-advance` — and fast-forwards the integration branch onto pre-fix orphan commits when safe.

When the executor's contamination handler sees a "unique" foreign commit, it now also asks:
- Does the commit's `Fusion-Task-Id` trailer point at a `done` task?
- Is the commit unreachable from `refs/heads/<integrationBranch>`?

If both, the commit is an orphan from the pre-fix non-FF ref-advance bug. Recovery attempts to fast-forward the integration branch onto the orphan:

- **FF possible** (integration tip is an ancestor of the orphan): advance via `advanceIntegrationBranchRef`, then drop the orphan from the task branch alongside `already-upstream` commits. Emits `merger:orphan-rehome-ff`.
- **Non-FF** (orphan diverges from integration tip — would require cherry-pick): refuse to auto-rehome. The commit stays in `genuinelyUnique` for human adjudication, but the recovery log line now includes the exact `git cherry-pick <sha>` command an operator can run to unstick it. Emits `merger:orphan-rehome-refused`.

The non-FF refusal is intentional: cherry-pick into the integration branch from inside automated recovery introduces conflict-resolution surface that's too high blast radius for a never-event recovery path.
