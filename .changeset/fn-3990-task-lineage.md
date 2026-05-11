---
"@runfusion/fusion": patch
---

Add dashboard support for task lineage commit associations by introducing `GET /api/tasks/:id/commit-associations`, wiring a dedicated client helper, and surfacing confidence-labeled lineage rows in the Task Changes tab.