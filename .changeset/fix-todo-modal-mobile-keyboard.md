---
"@runfusion/fusion": patch
---

Fix mobile dashboard shifted state after closing Todo modal. The TodoModal now uses `useMobileKeyboard` to track visual viewport changes, preventing the underlying dashboard layout from becoming offset when the virtual keyboard opens and closes.
