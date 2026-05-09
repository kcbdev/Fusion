---
"@runfusion/fusion": patch
---

Tighten merger scope-warning diff base for legacy/imported tasks lacking `baseBranch`. `resolveTaskDiffBaseRef` now mirrors the dashboard's display-recovery path: when `baseBranch` is missing, it computes `merge-base(HEAD, main)` and prefers it over a stale `baseCommitSha` only when the merge-base strictly descends the recorded SHA. Previously these tasks compared against the original fork point, so a pre-merge rebase pulled every unrelated commit landed on main into the diff and produced bogus "N files changed outside declared File Scope" warnings (e.g., FN-3898 saw 17 ghost files for a 3-file change). The FN-2855 deleted-feature-branch path is preserved.
