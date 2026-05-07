---
"@runfusion/fusion": patch
---

Fix Codex weekly usage pace calculation when the API returns `reset_at` as epoch milliseconds instead of seconds. The dashboard now parses both formats correctly so weekly reset countdowns and pace status reflect reality.
