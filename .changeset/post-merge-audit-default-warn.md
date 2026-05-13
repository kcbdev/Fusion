---
"@runfusion/fusion": patch
---

Change default `postMergeAuditMode` from `"block"` to `"warn"`. The post-merge audit still runs and findings are still logged on every merge — only the auto-completion gate is relaxed. This avoids FN-4277-class auto-merge failure storms on verified-rebase merges with overlap-only false positives. The file-scope invariant remains a stricter floor. Users who want the previous stricter behavior can set `postMergeAuditMode: "block"` explicitly in `.fusion/config.json`.
