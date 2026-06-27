---
"@runfusion/fusion": patch
---

summary: Recover corrupt messaging indexes during send or report the exact repair command.
category: fix
dev: MessageStore now runs a scoped REINDEX messages retry on SQLite corruption during send.
