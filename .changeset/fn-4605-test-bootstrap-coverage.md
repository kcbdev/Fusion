---
"@runfusion/fusion": patch
---

Test bootstrap (scripts/ensure-test-artifacts.mjs) now covers @fusion/engine and additional `@fusion-plugin-examples/*` packages so fresh-worktree test runs no longer fail with opaque `Failed to resolve import` errors. Adds package-level `pretest` hooks for the dashboard and dependency-graph plugin, and improves remediation output to name exact missing/stale artifact paths.
