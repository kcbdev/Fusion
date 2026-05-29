---
"@runfusion/fusion": patch
---

feat(FN-5633): standalone AI merge path (clean-room merge + AI reviewer)

Adds a self-contained AI merge path (`merger.mode: "ai"`, the new default) that the engine dispatches to instead of the legacy `aiMergeTask` pipeline. It does not share the legacy scaffolding (prerebase / conflict-strategy ladder / post-merge audit / transient self-heal), which was buggy and error-prone.

How it works:
- **Clean room**: a throwaway detached worktree is created at the target branch's current tip, so the user's real checkout is never the merge surface — dirty files cannot be clobbered and the landing is a fast-forward by construction.
- **AI merge**: an AI agent merges the task branch into the clean room and produces one squash commit, resolving conflicts in favor of the task's intent.
- **AI reviewer with retries**: a fresh read-only reviewer audits the squash (completeness / collateral / conflict-soundness) and classifies any veto blocking vs advisory. It drives up to `merger.maxReviewPasses` corrective re-merges. After the budget, advisory concerns land with a logged warning; an unfixable BLOCKING (correctness) concern hard-fails (`AiMergeBlockedError`) rather than ship wrong code. Verdict parsing fails safe to blocking.
- **Per-task target branch**: each task merges into its own target branch (or the default integration branch). The local checkout is only synced when it is on that target.
- **Local checkout sync**: when the checkout is on the target branch, the ref + working tree advance together via `git merge --ff-only` (dirty state read accurately before the move); dirty edits are stashed, fast-forwarded, and restored — and if the restore conflicts the AI merger reconciles them (the original edits are also kept in a stash as a backup). A checkout on a different branch is advanced via `update-ref` and left untouched. Un-stashable dirty state advances the ref and leaves the working tree with a warning. Concurrent advances trigger a bounded rebuild on the new tip.
- **Status + logs**: progress (merging / reviewing / corrective passes / landing / blocked / landed) is written to the task status pill and the task log stream.

Settings: `merger.mode` (`ai` default / `deterministic` legacy), `merger.reviewerModel`, `merger.maxReviewPasses` (default 3), surfaced in Settings → Merge. When AI merge is on, the legacy merge-mechanics settings (integration worktree, conflict strategy, overlap guard, post-merge audit, direct-commit routing) are hidden since they do not apply.

Commit message: the AI agent writes the squash commit subject as a concise summary of the actual changes (not just the task title), and every landed squash carries the board-association trailers — `Fusion-Task-Id: <taskId>` plus the canonical lineage trailer when the task has a `lineageId` — guaranteed via an idempotent amend even if the agent omits them, so the board associates the commit with the task.

Verification: the merge agent is instructed to run the project's tests, type-check, and lint after resolving the merge and to fix any NEW failure the merge introduced (without being on the hook for pre-existing breakage) before committing.

Editable prompt: the AI merge agent's base persona is the editable "merger" role prompt (Settings → Prompts); the non-negotiable clean-room / verification / commit-trailer rules are always appended so a custom prompt can't drop them.

Reviewer model: the reviewer agent uses the project's reviewer/validator model lane (`resolveValidatorSettingsModel`: project validator → global validator → project default), not a merge-specific setting.

No-branch guard: a missing task branch is a benign no-op only when the task was never executed or was already merged (branch cleaned up on re-process); if the task was executed (`baseCommitSha` recorded) and was never merged, the merge fails loudly rather than silently marking the task done.

The legacy `aiMergeTask` pipeline is retained unchanged and used when `merger.mode: "deterministic"`.

Tests: `merger-ai.test.ts` covers the verdict parser, clean merge, blocking hard-fail (no advance), advisory land, empty no-op, per-task target branch isolation, missing-target-branch error, and `landSquash` (clean ff, other-branch update-ref, dirty stash-restore, AI-resolved restore conflict). Engine merge-orchestration tests that assert the legacy path are pinned to `merger.mode: "deterministic"`.
