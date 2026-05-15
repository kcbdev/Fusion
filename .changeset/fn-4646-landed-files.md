---
"@runfusion/fusion": patch
---

Fix post-merge metadata consistency by capturing and reconciling landed file lists. Done-task metadata and UI now prefer the final landed diff file set, with executor `modifiedFiles` retained as the in-flight fallback.
