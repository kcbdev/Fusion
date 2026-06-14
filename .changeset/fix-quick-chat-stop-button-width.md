---
"@runfusion/fusion": patch
---

Fix the quick chat stop button rendering too narrow. It borrowed ChatView's `.chat-input-stop` styling, which sizes itself with `--chat-input-control-size` — a variable scoped to ChatView's composer and undefined in the quick chat DOM — collapsing the button toward its icon width. It is now pinned to the send button's square dimensions.
