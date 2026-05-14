---
"@runfusion/fusion": patch
---

Emit `git` / `merge:file-scope-violation` run_audit event when the merger's file-scope invariant aborts a squash, enabling the `fileScopeInvariantFailuresPerDay` reliability metric.
