---
"@runfusion/fusion": patch
---

Hardened worktree pool leasing with explicit lease ownership tracking, double-lease invariant detection, and `worktree:pool-double-lease-detected` audit emission, plus merger cleanup ordering that detaches and clears task worktree metadata before pooled release.
