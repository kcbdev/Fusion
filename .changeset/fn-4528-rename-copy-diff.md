---
"@runfusion/fusion": patch
---

Dashboard task diff APIs now return destination paths for renamed/copied files and count them once (instead of add+delete pairs) when serving in-progress/in-review tasks via branch-ref fallback.
