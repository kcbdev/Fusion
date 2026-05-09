---
"@runfusion/fusion": patch
---

Main chat no longer surfaces a confusing "Load failed" error banner when the
browser tab is backgrounded during a streaming reply. Tab-suspension network
errors are now treated as benign interruptions and the conversation silently
reconciles with the server on tab return.
