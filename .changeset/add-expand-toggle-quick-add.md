---
"@gsxdsm/fusion": patch
---

Add expand/collapse toggle button to Quick Add views in dashboard

- Replaced auto-expand behavior with manual toggle button in QuickEntryBox (list view) and InlineCreateCard (board view)
- Users can now click a chevron button to show/hide advanced options (Deps, Models, Plan, Subtask, Refine)
- Expanded state persists until manually toggled or task is submitted/cancelled
- Provides cleaner default UI while keeping advanced options easily discoverable
