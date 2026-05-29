---
"@runfusion/fusion": minor
---

Add a new `fn_goal_show` tool for goal retrieval by ID, including structured JSON output via `details.goal` and a stable not-found contract (`GOAL_NOT_FOUND`).

Also register `fn_goal_list` and `fn_goal_show` in the engine readonly tool allowlist so agent runtime sessions can use goal retrieval on the readonly path.