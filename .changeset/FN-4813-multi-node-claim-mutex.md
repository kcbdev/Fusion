---
"@runfusion/fusion": patch
---

Add multi-node coordination hardening for task execution: distributed checkout claim mutex (`tryClaimCheckout`) with node/epoch preconditions, configurable `owningNodeHandoffPolicy` behavior for unavailable owners, and a supported `transitionProjectIsolation` path that can restart project runtimes (with rollback when active-task restart is blocked). Reaffirm scheduler failover and live process migration as explicit non-goals in mesh/multi-project docs.
