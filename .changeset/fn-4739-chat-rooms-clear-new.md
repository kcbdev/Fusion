---
"@runfusion/fusion": minor
---

Chat rooms now support `/clear` and `/new` in the composer by clearing the active room transcript instead of sending those commands as normal messages. Added a new API route, `DELETE /api/chat/rooms/:id/messages`, to bulk-clear all messages in a room while preserving room identity and membership.
