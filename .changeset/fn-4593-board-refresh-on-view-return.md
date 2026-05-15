---
"@runfusion/fusion": patch
---

Dashboard board and list views now refetch tasks once when the user navigates back from another dashboard view, so internal view switches no longer leave task data stale while task SSE was temporarily disabled.
