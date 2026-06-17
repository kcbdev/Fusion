---
"@runfusion/fusion": patch
---

Fix regular chat (ChatView) messages disappearing after leaving and returning to a conversation. The chat message **writer** (`POST /api/chat/sessions/:id/messages`, plus cancel and `isGenerating` enrichment) resolved its per-project `ChatManager`/`ChatStore` through `getOrCreateProjectStore`, while the **reader** (`GET /api/chat/sessions/:id/messages`) resolves through the engine-aware `resolveProjectChatContext`. When those resolved to different store instances, a sent message persisted to one store but the reload read from another, so it vanished on return. The writer now resolves through the same `resolveProjectChatContext` path as the reader, guaranteeing writes and reads share one store. Quick Chat masked the bug by keeping its thread warm in memory (no server reload).
