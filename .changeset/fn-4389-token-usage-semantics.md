---
"@runfusion/fusion": patch
---

Canonicalize task token usage semantics across heartbeat and executor paths by treating `cachedTokens` as cache-read only, storing cache writes in new `cacheWriteTokens`, and preserving raw `inputTokens`.

Dashboard token stats now render separate `Cache read` and `Cache write` values.

Historical rows created before this fix may still contain mixed cache-read+cache-write values inside `cachedTokens`; existing data is not backfilled.
