# Test velocity baseline

> Weekly FN-6612 signal-per-second baseline. Measure and report feedback-loop velocity; do **not** add slow tests or wire this report into blocking PR checks. The merge gate remains the existing thin Lint, Typecheck, Build, and Gate path.

## Latest baseline

- Cycle: **2026-W26**
- Captured at: **2026-06-27T02:02:13.530Z**
- Timing snapshot: `scripts/test-timings.json` captured at **2026-06-25T05:45:08.116Z**; SettingsModal rows below include the FN-7087 scoped refresh captured from `dashboard-app-quality-settings` after the monolith split.
- Quarantine ledger: `scripts/lib/test-quarantine.json`

## Metrics

| Metric | Current | Delta vs previous |
|---|---:|---:|
| Merge gate wall-time (`pnpm test:gate`) | 8.1s | +649ms |
| Boot smoke wall-time (`pnpm smoke:boot`) | 17.6s | -603ms |
| Changed-only test wall-time (`pnpm test`) | unavailable | n/a |
| Quarantine / flake count | 0 | 0 |
| Deletion-due quarantines | 0 | n/a |

## Measurement failures

- Changed-only tests (`pnpm test`): exit 1 after 31.0s. The failure was outside the FN-7087 SettingsModal scoped run, so the weekly generated snapshot was hand-corrected with the successful split SettingsModal measurement pending the next fully green weekly refresh.

## Timing snapshot notes

- FN-7087 manually replaced the obsolete `SettingsModal` monolith entry with the four current split files measured by `pnpm --filter @fusion/dashboard exec vitest run --project dashboard-app-quality-settings --reporter=default --silent=passed-only`.
- One historical slow-file entry in `scripts/test-timings.json` still points at a removed ChatView path; refresh `scripts/test-timings.json` after the changed-only lane is green before selecting the next slow-test rewrite from this report.

## Slowest known current test files and settings split refresh

| Rank | File | Package | Duration |
|---:|---|---|---:|
| 1 | `packages/dashboard/src/__tests__/insights-routes.test.ts` | @fusion/dashboard | 26.5s |
| 2 | `packages/engine/src/runtimes/__tests__/in-process-runtime.test.ts` | @fusion/engine | 24.7s |
| 3 | `packages/dashboard/src/__tests__/workflow-routes.test.ts` | @fusion/dashboard | 22.0s |
| 4 | `packages/core/src/__tests__/db.test.ts` | @fusion/core | 21.2s |
| 5 | `packages/dashboard/app/components/__tests__/GitManagerModal.test.tsx` | @fusion/dashboard | 16.9s |
| 6 | `packages/core/src/__tests__/mission-store.test.ts` | @fusion/core | 16.0s |
| 7 | `packages/cli/src/__tests__/extension.test.ts` | @runfusion/fusion | 15.7s |
| 8 | `packages/dashboard/app/components/__tests__/AgentPromptsManager.test.tsx` | @fusion/dashboard | 14.8s |
| 9 | `packages/dashboard/app/components/__tests__/App.test.tsx` | @fusion/dashboard | 14.6s |
| 10 | `packages/dashboard/app/components/__tests__/TaskDetailModal.inline-editing-and-integrations.test.tsx` | @fusion/dashboard | 14.1s |
| 11 | `packages/dashboard/app/components/__tests__/TaskDetailModal.rendering.test.tsx` | @fusion/dashboard | 13.7s |
| 12 | `packages/dashboard/src/__tests__/routes-auth.test.ts` | @fusion/dashboard | 13.6s |
| 13 | `packages/core/src/__tests__/agent-store.test.ts` | @fusion/core | 13.4s |
| 14 | `packages/dashboard/app/components/__tests__/SettingsModal.scheduling-merge.test.tsx` | @fusion/dashboard | 12.8s |
| 15 | `packages/engine/src/__tests__/workspace-merger-idempotency.test.ts` | @fusion/engine | 12.7s |
| 16 | `packages/engine/src/__tests__/self-healing-workspace.test.ts` | @fusion/engine | 11.8s |
| 17 | `packages/engine/src/__tests__/pr-response-run.test.ts` | @fusion/engine | 11.6s |
| 18 | `packages/dashboard/app/components/__tests__/ListView.test.tsx` | @fusion/dashboard | 11.3s |
| 19 | `packages/dashboard/app/components/__tests__/SettingsModal.general.test.tsx` | @fusion/dashboard | 11.2s |
| 20 | `plugins/fusion-plugin-compound-engineering/src/__tests__/sync.test.ts` | @fusion-plugin-examples/compound-engineering | 11.0s |

### FN-7087 SettingsModal split files

| File | Tests | Duration |
|---|---:|---:|
| `packages/dashboard/app/components/__tests__/SettingsModal.remote-notifications.test.tsx` | 59 | 10.6s |
| `packages/dashboard/app/components/__tests__/SettingsModal.models-auth.test.tsx` | 57 | 10.4s |
| `packages/dashboard/app/components/__tests__/SettingsModal.scheduling-merge.test.tsx` | 97 | 12.8s |
| `packages/dashboard/app/components/__tests__/SettingsModal.general.test.tsx` | 53 | 11.2s |

## Quarantine age buckets

| Age bucket | Count |
|---|---:|
| 0-6 days | 0 |
| 7-13 days | 0 |
| deletion due (>=14 days) | 0 |
| unknown/future | 0 |

### Deletion-due entries

| File | Quarantined at | Age (days) |
|---|---:|---:|
| — | — | — |

## Before / after trend

| Row | Captured at | Gate | Boot smoke | `pnpm test` | Quarantine count |
|---|---|---:|---:|---:|---:|
| Previous | 2026-06-25T05:47:54.804Z | 7.5s | 18.2s | 9.4s | 0 |
| Latest | 2026-06-27T02:02:13.530Z | 8.1s | 17.6s | unavailable | 0 |
| Delta | — | +649ms | -603ms | n/a | 0 |

_Future weekly rows append to `scripts/test-velocity-history.json`; compare the latest row against the previous row before posting to #leads._

## Post to #leads

```text
FN-6612 weekly test velocity: gate 8.1s (+649ms), boot smoke 17.6s (-603ms), pnpm test unavailable (n/a), quarantine ledger 0 (0). Slowest known current file: packages/dashboard/src/__tests__/insights-routes.test.ts at 26.5s; SettingsModal split refresh slowest sibling: packages/dashboard/app/components/__tests__/SettingsModal.scheduling-merge.test.tsx at 12.8s. Deletion-due quarantines: 0.
```

## How to refresh

```bash
pnpm test:velocity -- --measure --write-report
```

In measure mode, the script runs a non-measured `pnpm build` preflight before timing `pnpm test:gate`, `pnpm smoke:boot`, or `pnpm test`. The preflight time is setup only and is excluded from lane metrics; if it fails, the Measurement failures section records `Build preflight (pnpm build)` as the reason. Use `--skip-build-preflight` only when the workspace is already built by CI.

Report-only regeneration is cheap and does not run any suite:

```bash
pnpm test:velocity
```
