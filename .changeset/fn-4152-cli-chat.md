---
"@runfusion/fusion": patch
---

Add `fn chat <agent-id>` for interactive REPL conversations with an agent from the CLI. Sends messages via the project's MessageStore (so a running `fn` / `fn serve` engine wakes the agent) and polls for replies.
