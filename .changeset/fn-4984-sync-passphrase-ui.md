---
"@runfusion/fusion": minor
---

Add dashboard UI panel and `/api/secrets/sync-passphrase` routes to configure the cross-node secrets-sync passphrase. Reserved `__sync_passphrase__` row is filtered out of the standard secrets list. Plaintext is never returned over HTTP.
