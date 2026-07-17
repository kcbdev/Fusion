---
"@runfusion/fusion": minor
---

summary: Add Todo API read + create-task endpoints so scripts can turn a todo into a running task.
category: feature
dev: New `/api/todos/:id`, `/api/todos/:id/items`, `/api/todos/items/:id`, and `POST /api/todos/items/:id/create-task` routes in todo-routes.ts; AsyncTodoStore gains getList/getItem/listItems; create-task validates title/priority/workflowId/assignedAgentId, honors body projectId scoping, and delegates to TaskStore.createTask with source.sourceType="api".
