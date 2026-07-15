---
"@runfusion/fusion": minor
---

summary: Add a diagnostic summary and one-click "Retry with a different model/node" to the Task Failed banner.
category: feature
dev: TaskDetailModal now renders the banner for all failed tasks (including errorless), surfaces the latest tool_error detail (FN-7995), and applies model/node overrides via updateTask before re-running the existing retry path.
