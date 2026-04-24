# Phase 0 Baseline — Test Suite Measurement

Captured 2026-04-24. Three consecutive `pnpm test` runs from a warm-ish state (cache existed from prior work). No code changes between runs.

## Wall-clock per full run

| Run | Duration | Exit | Notes |
|----:|---------:|:----:|-------|
| 1   | 151s     | ❌ 1  | 2 failed tests (see Flakes) |
| 2   | 137s     | ✅ 0  | 9,680 tests passed |
| 3   |  95s     | ✅ 0  | fully warm cache |

Warm-cache floor ≈ **95s**. Full-rebuild ceiling ≈ **151s**. Variance driven mostly by vitest collect + core's SQLite setup.

## Per-package (run 2, representative)

| Package | Files | Wall (s) | Test CPU (s) | Notes |
|---|---:|---:|---:|---|
| **core** | 67 | 91.4 | 274.0 | **dominant wall cost**; heavy SQLite, worker-pool capped |
| **dashboard** | 329 | 33.9 | 220.2 | massively parallel, highest test count |
| engine | 64 | 5.9 | 15.9 | lean |
| cli | 41 | 3.7 | 12.5 | lean |
| tui | 4 | 2.1 | 2.5 | |
| desktop | 14 | 0.9 | 0.9 | |
| pi-claude-cli | 9 | 0.6 | 0.2 | |
| mobile | 3 | 0.5 | <0.1 | |
| plugin-sdk | 1 | 0.17 | <0.01 | |
| 7 plugins | 8 | <0.4 ea | trivial | |
| **TOTAL** | **540** | ≈137s | ≈526s CPU | |

**Where the time goes** — core (67%) + dashboard (25%) = 92% of wall-clock. Everything else combined is < 10s.

## Flakes detected

Run 1 failed; runs 2 & 3 were green → **1/3 flake rate at the suite level**. Two distinct flaky tests, both in `packages/dashboard`:

1. `src/__tests__/routes-diff.test.ts > GET /api/tasks/:id/diff > returns 404 when task not found`
   - Mode: 5000ms testTimeout exceeded. Test just calls a handler with a mock store — no legitimate reason to take >5s. Almost certainly state leakage or fake-timer hang.

2. `app/components/__tests__/QuickEntryBox.test.tsx > Rich creation features > resets all state after successful creation (disclosure resets to collapsed)`
   - Mode: assertion `textarea.value === ""` got `"Task to reset"`. State leak from a prior test in the same file (textarea re-used across iterations before reset).

Both are in the `__tests__/` variant of the dashboard dual-test-dir duplication (see test-cull-duplicates.md). Note: these files may be the newer/larger replacements — deleting the companion flat-dir copies is still safe, but these two cannot just be deleted since they cover real endpoints. Fix or skip candidates for Phase 4.

## Confirmed Phase 1 duplicates

9 component/hook test files are duplicated between `packages/dashboard/app/**/*.test.tsx` (flat) and `packages/dashboard/app/**/__tests__/*.test.tsx`. Full table in `.planning/test-cull-duplicates.md`. Back-of-envelope LOC the flat copies alone: ~5,150 LOC; some `__tests__` copies are smaller and are the redundant side. Cheap win — just need to diff each pair and delete the less-complete one.

## Headline numbers to beat

- **540 test files → target <300** after Phases 1+2
- **137s warm-ish wall time → target < 90s**
- **Flake rate 1/3 → target 0/5**
- **9,680 passing tests → target unchanged in *meaningful* coverage**, but LOC down ≥ 30%

## Raw artifacts

- `.planning/test-baseline-run1.log` (failed — includes flake stack traces)
- `.planning/test-baseline-run2.log` (green)
- `.planning/test-baseline-run3.log` (green)
- `.planning/test-baseline-times.txt`

## Ready for Phase 1

Next step: diff each of the 9 duplicate pairs and delete the redundant copy. `QuickScriptsDropdown`, `useProjects`, `useUsageData`, `useActivityLog` have the flat version *larger* — suggests the `__tests__` copy is the stale one for those. For the other five, `__tests__` is larger.

Awaiting go-ahead before deletions.
