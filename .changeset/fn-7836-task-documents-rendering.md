---
"@runfusion/fusion": patch
---

summary: Fix the Artifacts Task Documents list rendering as blank rows when documents are loaded.
category: fix
dev: Root cause was flex-shrinking task cards in DocumentsView.css; cards now opt out of shrink and DocumentsView.test.tsx covers loaded 50+ group rendering.
