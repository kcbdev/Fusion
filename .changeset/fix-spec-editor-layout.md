---
"@dustinbyrne/kb": patch
---

Fix SpecEditor layout in task detail modal

The SpecEditor's edit view now properly fills the available vertical space
in the task detail modal. Added flex constraints to the spec tab wrapper
container so the textarea expands to fill space between the tabs and modal
bottom, with proper scrolling behavior for long content.
