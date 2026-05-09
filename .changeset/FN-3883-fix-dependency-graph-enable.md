---
"@runfusion/fusion": patch
---

Fix Dependency Graph plugin failing to enable from Settings by correcting package exports/build output and ensuring bundled CLI staging includes compiled plugin dist assets. Also surface the loader's actual enable error in Plugin Manager toast messaging when enable returns `state: "error"`.
