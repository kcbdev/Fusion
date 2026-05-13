---
"@runfusion/fusion": patch
---

Prevented merger squash commits from carrying gitignored files by unstaging ignored paths (including `.fusion/` task artifacts) before writing merge commits.
