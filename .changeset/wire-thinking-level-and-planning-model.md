---
"@gsxdsm/fusion": minor
---

Add thinkingLevel UI control and wire up planningModel in task creation forms.

- **Thinking Level selector** in the Model tab of task detail modal: choose reasoning effort (off/minimal/low/medium/high) per task
- **Thinking Level in task creation**: New tasks can specify a thinking level via the creation form
- **Planning Model in task creation**: QuickEntryBox and NewTaskModal now correctly send the planning model selection to the backend (previously the UI state was tracked but never submitted)
- **Backend API**: POST/PATCH `/api/tasks` now accept and validate `thinkingLevel` and `planningModelProvider`/`planningModelId` fields
