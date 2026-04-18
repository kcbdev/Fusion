---
"@gsxdsm/fusion": patch
---

Allow permanent agents with identity (soul, instructions, memory) to run heartbeat sessions even when they have no task assignment. Previously, agents without a task assignment would bail immediately with `reason: "no_assignment"`. Now, agents with meaningful identity content get a full session where they can perform ambient work like messaging, memory management, task creation, and delegation. Ephemeral agents and agents without identity continue to exit gracefully as before.
