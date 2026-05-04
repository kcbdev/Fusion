---
"@fusion/engine": patch
---

Fix heartbeat and manual agent runs ignoring the agent's configured model. The dashboard saves `runtimeConfig.model` as a combined `"provider/modelId"` string, but heartbeat was reading non-existent split `modelProvider`/`modelId` fields, causing sessions to fall through to pi's default model (often `openai-codex`) and fail with "No API key for provider: openai-codex".
