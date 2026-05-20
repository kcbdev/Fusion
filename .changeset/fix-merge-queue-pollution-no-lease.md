---
"@runfusion/fusion": patch
---

Fix merge queue lease race causing all in-review tasks to fail with merge:reuse-handoff-refused (no-lease) when unrelated tasks pollute the queue head. acquireReuseHandoff now targets the specific task ID rather than blindly grabbing the queue head, so the correct task gets the lease regardless of stale queue entries.
