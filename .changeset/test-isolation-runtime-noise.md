---
"fusion-workspace": patch
---

scripts: make `check-test-isolation` resilient to a concurrently-running fusion app on the same HOME. Filter out paths the live app legitimately writes (databases, agent sessions/memory, plugins, automations, logs, config), sample the baseline over a longer window, and re-sample on suspected violations to avoid false positives during local `pnpm test:isolated`.
