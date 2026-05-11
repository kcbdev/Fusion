---
"@runfusion/fusion": patch
---

fix(FN-3906): auto-skip the built-in Frontend UX Design pre-merge workflow step when the task diff scope has no frontend/UI files, so non-frontend tasks no longer get stuck behind paused completion handoff deferrals for an irrelevant review gate.
