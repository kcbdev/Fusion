---
"@runfusion/fusion": minor
---

Add `noCommitsExpected` task-level flag so decision-only / evaluation tasks can complete cleanly without tripping the executor's `no_commits` invariant. Triage auto-detects decision-shaped tasks; the flag can also be set manually from the task detail modal and is surfaced as a badge on TaskCard. The existing merger no-op finalization path handles completion.
