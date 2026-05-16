---
"@runfusion/fusion": patch
---

GitHub tracking-issue creation now searches the target repo (open and closed
issues) for likely duplicates before opening a new issue, keyed on the task's
File Scope paths and symptom keywords. Matches link the existing issue to the
Fusion task. Opt out with project setting `githubTrackingDedupEnabled: false`.
