# Confirmed dashboard test duplicates

9 components/hooks have two parallel test files in `packages/dashboard`: one in the flat dir and one in a sibling `__tests__/` dir. Same filename, different content.

| Subject | flat (LOC) | `__tests__/` (LOC) | Larger |
|---|---|---|---|
| TaskCard.test.tsx | 556 | 4399 | __tests__ |
| SettingsModal.test.tsx | 893 | 4317 | __tests__ |
| Header.test.tsx | 1125 | 1710 | __tests__ |
| QuickScriptsDropdown.test.tsx | 510 | 196 | flat |
| MissionInterviewModal.test.tsx | ? | ? | — |
| AgentImportModal.test.tsx | ? | ? | — |
| useProjects.test.ts | 446 | 419 | flat |
| useUsageData.test.ts | 108 | 59 | flat |
| useActivityLog.test.ts | 280 | 92 | flat |

Both vitest configs (if any per-pkg excludes) need checking — some of these may already be excluded from the run.

## Cross-package integration overlap

| File | core (LOC) | engine (LOC) |
|---|---|---|
| mission-factory-parity.integration.test.ts | 544 | 666 |
| run-audit.integration.test.ts | 560 | 703 |

Not true duplicates (different packages own different implementations) but contract overlap warrants review before Phase 1 deletion.

## Next step

Before deleting any flat-vs-`__tests__` pair, `diff` the two to confirm they really cover the same thing. Auto-assumption: `__tests__/` is newer and larger wins; flat version is stale. QuickScriptsDropdown, useProjects, useUsageData, useActivityLog break that pattern — the flat file is larger, so the `__tests__` copy may be the redundant one.
