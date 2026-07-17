---
"@runfusion/fusion": patch
---

summary: Reject messages addressed to nonexistent agent recipients.
category: fix
dev: fn_send_message now validates agent recipients through the async AgentStore lookup before delivery.
