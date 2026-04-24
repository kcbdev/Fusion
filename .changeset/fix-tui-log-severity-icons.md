---
"@runfusion/fusion": patch
---

Fix dashboard TUI log severity rendering so structured `logger.log(...)` entries routed via `stderr` display with info severity/icon instead of being misclassified as errors.
