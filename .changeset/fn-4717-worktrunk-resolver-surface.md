---
"@runfusion/fusion": patch
---

Widen `resolveWorktreeBackend` to accept an optional `binaryPathResolver`, allow `WorktrunkWorktreeBackend` to be constructed with a lazy resolver in place of a literal path, and finalize the `resolveWorktrunkBinary` return contract (adds `installed-release` / `installed-cargo` source variants and an optional `actionGateContext`). Internal surface widening that unblocks FN-4681's binary-resolver wiring; no runtime behavior change for existing callers.
