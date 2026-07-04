---
"@runfusion/fusion": patch
---

summary: Fix mobile Chat composer being hidden behind the keyboard accessory bar.
category: fix
dev: Adds keyboard-open bottom clearance in ChatView so the composer clears the iOS input-assistant/autofill bar without a persistent .chat-thread transform or Android reserved-gap.
