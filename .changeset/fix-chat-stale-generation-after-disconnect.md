---
"@runfusion/fusion": patch
---

Fix Quick Chat: messages would silently fail after closing the browser tab mid-response and reopening it. The backend agent kept running with no listener and left a stale `activeGenerations` slot; the next message's freshly-opened CLI session then raced against the lingering agent on the same session file. The `/messages` route now calls `chatManager.cancelGeneration` when the client disconnects before the response ended, and `beginGeneration` only aborts the previous generation's controller instead of pre-emptively disposing its agent (the previous agent's own `finally` handles dispose, so we don't tear down the CLI process under the new agent).
