---
"@runfusion/fusion": patch
---

summary: Fix Quick Add action-row buttons (Save, Attach, Fast, workflow trigger) rendering at mismatched heights.
category: fix
dev: Adds a scoped `min-height` on `.quick-entry-actions .btn` and `.wf-optional-steps-dropdown-trigger` in `QuickEntryBox.css` (desktop base rule, alongside the existing mobile touch-target block) so every action-row control resolves one uniform box height regardless of icon-only vs text content or `.dep-trigger` padding differences. No shared `.btn`/`.btn-sm`/`.btn-icon`/`.btn-task-create`/`.dep-trigger` rules in `styles.css` were touched.
