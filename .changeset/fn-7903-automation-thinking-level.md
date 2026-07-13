---
"@runfusion/fusion": minor
---

summary: Schedule and routine AI steps now apply the chosen thinking level at run time.
category: feature
dev: Threads AutomationStep.thinkingLevel into createFnAgent (defaultThinkingLevel) across cron-runner, routine-runner, and the dashboard inline ai-prompt path, and maps it onto create-task steps' task thinkingLevel (FN-7903, follow-up to FN-7900).
