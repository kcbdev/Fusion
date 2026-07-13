---
"@runfusion/fusion": patch
---

summary: Mailbox artifact "View task" now opens the same movable, resizable task window used elsewhere.
category: fix
dev: MainContent mailbox onOpenTask routes fetchTaskDetail -> popOutTaskDetail (floating-window--task-detail) instead of the docked openDetailTask modal, matching DocumentsView's artifact-task path.
