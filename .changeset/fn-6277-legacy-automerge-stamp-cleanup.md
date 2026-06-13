---
"@runfusion/fusion": patch
---

Add `autoMergeProvenance` so Fusion can distinguish explicit per-task auto-merge overrides from legacy review-entry stamps. Startup now marks ambiguous legacy in-review `autoMerge: true` rows as `legacy-stamp` without changing behavior, and the operator-visible `reconcileLegacyAutoMergeStamps` action (dry-run by default) can clear those legacy stamps so global auto-merge OFF is respected while genuine user overrides are preserved.
