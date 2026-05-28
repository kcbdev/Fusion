---
"@runfusion/fusion": patch
---

fix(FN-5627): always rebase behind branches before squash regardless of user-configured prerebase threshold

After the FN-5627 default-threshold fix landed (threshold=1 default), tasks were still getting stuck at `mergeRetries=3` with `Integration branch main advanced concurrently (expected X, observed X)` errors because user projects with explicit `prerebaseDivergenceThreshold` values higher than the branch's commits-behind count still skipped prerebase entirely.

Example: a project with `prerebaseDivergenceThreshold: 50` for low-noise PR experience would skip prerebase on a task branched 4 commits behind main. The squash commit then doesn't descend from current main, and `git update-ref` correctly refuses the non-fast-forward advance — producing the misleading same-SHA error signature that stranded FN-5626, FN-5628, FN-5633.

Root distinction missed in the earlier fix: the user-configurable `prerebaseDivergenceThreshold` controls the *user-visible severity reporting* ("this branch is N commits behind"), while engine correctness requires a *safety invariant* ("any branch behind main MUST be rebased before squash, or update-ref will fail"). These are independent concerns.

New behavior:
- After the hot-file and threshold checks, `decideAutoPrerebase()` now returns `fire: true` with `reason: "safety-fallback-any-divergence"` whenever `commitsBehind > 0`.
- The threshold-based path still wins when tripped (so user-visible audit `reason` reflects the configured policy when applicable).
- Full opt-out remains `prerebaseAutoEnabled: false` — that case skips the safety fallback too, and the user accepts that behind-branch merges will fail.
- `prerebaseDivergenceThreshold: 0` is no longer a complete opt-out from the commit-count gate — it only suppresses the threshold-based reason label. Safety fallback still fires.

Tests:
- New `safety-fallback-any-divergence` reason added to `AutoPrerebaseDecision.reason` union.
- 4 commits behind with threshold=50 → fires via safety fallback (was: skipped).
- `prerebaseAutoEnabled=false` → no fire (full opt-out preserved).
- Configured threshold tripping still wins the `reason` label.
- Branch fully up-to-date (commitsBehind=0) → no-divergence (unchanged).
