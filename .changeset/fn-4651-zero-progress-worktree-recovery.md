---
"@runfusion/fusion": patch
---

Self-healing now auto-requeues `in-review` tasks that failed at session start
with an unusable-worktree error even when zero step progress was recorded.
Bounded by a 3-attempt cap; persistent failures stay in `in-review` for
human inspection.
