---
"@runfusion/fusion": patch
---

Engine now auto-hydrates each task worktree's `.fusion/fusion.db` with the current task plus transitive dependency rows and their `task_documents` on worktree creation, pool acquire, and resume. Cross-task `sqlite3 .fusion/fusion.db` lookups in PROMPT.md no longer fail silently. Falls through with a warning on any failure; worktree creation is never blocked.
