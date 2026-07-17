---
"@runfusion/fusion": patch
---

summary: Quick Add Deps/Models/Agent icons no longer render oversized on mobile.
category: fix
dev: Reverts FN-8186 — scopes the mobile (@media max-width:768px) glyph-size override in QuickEntryBox.css back to the primary-group icon controls so options-group glyphs (Deps/Models/Agent/Node/Workflow) fall back to their intrinsic size; desktop and the 36px touch-target floor unchanged.
