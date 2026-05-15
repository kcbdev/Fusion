---
"@runfusion/fusion": patch
---

Auto-finalize in-review tasks when self-healing or merge fast-path logic can prove task content already landed on the base branch, clearing soft blockers (`paused`, stale `failed` status, and residual error) while still preserving hard-blocker guardrails for incomplete steps, awaiting-user-review states, and pre-merge workflow failures.
