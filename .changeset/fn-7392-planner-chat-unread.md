---
"@runfusion/fusion": patch
---

summary: Keep hidden task-planner Chat replies from lighting the global Chat unread badge.
category: fix
dev: Enriches direct chat SSE payloads with session agent metadata plus common-feed visibility, then suppresses `task-planner:` unread badges only while hidden.
