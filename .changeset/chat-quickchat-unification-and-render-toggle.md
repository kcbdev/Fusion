---
"@runfusion/fusion": patch
---

Fix Quick Chat backend divergence and consolidate the chat render-mode toggle.

- Backend: Quick Chat and regular chat now go through a single agent-creation path (`createResolvedAgentSession`), eliminating the `createFnAgent` branch where pi-ai's `cleanupSessionResources(sessionId)` could tear down resources still in use by a newer generation. The `sendMessage` `finally` only disposes the agent if it still owns the `activeGenerations` slot, so a pre-empted generation no longer rips state out from under its successor.
- Frontend: extracted the SSE streaming-handler factory shared between `useChat` and `useQuickChat` (RAF coalescing, accumulators, tool-call dedup, fallback handling) into `createChatStreamHandlers`. Both hooks now compose it instead of duplicating ~85 LOC each.
- UX: removed per-message Markdown/plain-text eye toggles. A single thread-level toggle now lives in the chat header and flips every assistant bubble (including the streaming one) between rendered Markdown and plain text. Model-only chats also drop their per-message agent-identity row — the model is shown once in the thread header.
