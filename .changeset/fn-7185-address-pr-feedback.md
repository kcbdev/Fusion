---
"@runfusion/fusion": minor
---

summary: Add an "Address PR feedback" button that starts an AI session to resolve PR review comments.
category: feature
dev: New POST /tasks/:id/pr/address-feedback route seeds a ce-resolve-pr-feedback steering prompt and wakes the assigned agent; button gates on linked-PR actionable feedback (commentCount or CHANGES_REQUESTED).
