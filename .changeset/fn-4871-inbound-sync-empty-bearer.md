---
"@runfusion/fusion": patch
---

Inbound node settings sync (`/api/settings/sync-receive`, `/auth-receive`, `/auth-export`) now rejects requests when the local node `apiKey` is empty/missing or the Bearer token is empty, closing an `Authorization: Bearer ` bypass against unconfigured nodes. FN-4868 gap G-01.
