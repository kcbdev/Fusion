---
"@runfusion/fusion": minor
---

Adds goal-anchoring run-audit observability for Slice 2 hybrid anchoring with three `database` mutation types: `goal:injection-applied`, `goal:injection-skipped`, and `goal:retrieval-invoked`.

Events carry count-only metadata contracts (`count`, plus `lane` for injection and `toolName` for retrieval, with optional `truncated`/`reason`/`notFound`) and avoid prompt bodies or goal title/description payloads. These events are available through the existing `GET /api/agents/:id/runs/:runId/audit` timeline route with standard date-range filtering via `startTime`/`endTime`.
