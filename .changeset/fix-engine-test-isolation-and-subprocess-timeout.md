---
"@runfusion/fusion": patch
---

fix(engine-tests): eliminate full-suite temp-dir leak and harden subprocess guard against concurrent-workspace contention.

- Two engine merger tests (`merger-no-op-fix-finalize.test.ts`, `merger-verification-fix-already-on-main.test.ts`) created `mkdtempSync` workspaces directly under `tmpdir()` with the tracked `fusion-test-` prefix. Under `pnpm -r --workspace-concurrency=2` load, transient cleanup races left orphans flagged by `check-test-isolation`. Route both through `FUSION_TEST_WORKER_ROOT` like sibling merger tests so the dirs nest inside the already-tracked worker root and never appear as top-level leaks.

- Bump the engine vitest subprocess guard from 60 s to 120 s and the per-test timeout to 30 s. Under concurrent workspace runs, plain git commands (`git branch -d`, `git worktree remove --force`) queued behind system contention were timing out and failing reliability-interactions tests. The guard fires only on hangs, so healthy tests pay nothing for the higher ceiling.
