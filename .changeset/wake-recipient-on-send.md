---
"@runfusion/fusion": minor
---

Add a sender-side "wake recipient immediately" override for messages. The
message composer now offers a checkbox (when sending to an agent) that sets
`metadata.wakeRecipient: true` on the message. When honored, the recipient
agent is woken on receipt regardless of their own `messageResponseMode`
setting. To prevent agents from forcing wakes on each other, only
human-originated messages (`fromType: "user"`) trigger the override —
agent-to-agent traffic continues to respect the recipient's configured
behavior.
