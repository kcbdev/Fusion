---
"@runfusion/fusion": patch
---

summary: Remove the gap above the pinned provider header in model dropdowns so list rows no longer show through while scrolling.
category: fix
dev: CustomModelDropdown.css — zero the .model-combobox-list top padding so the sticky .model-combobox-optgroup provider header sits flush against the header stack (FN-8212 refinement of FN-8193).
