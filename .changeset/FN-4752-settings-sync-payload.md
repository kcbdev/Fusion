---
"@runfusion/fusion": patch
---

Fix settings sync push/receive payload contract: the push endpoint now includes `sourceNodeId` so the inbound `/api/settings/sync-receive` validator no longer rejects round-trips with a 400.
