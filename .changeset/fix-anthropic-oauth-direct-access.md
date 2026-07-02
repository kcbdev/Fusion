---
"@runfusion/fusion": patch
---

summary: Fix Anthropic Claude subscription chats failing (404/502/429) by restoring direct OAuth execution.
category: fix
dev: Reverts the FN-7391/FN-7396 runtime rerouting that sent subscription OAuth to a `/v1`-based `anthropic-subscription` provider (reintroducing issue #1857). `getApiKey("anthropic")` again resolves subscription/legacy OAuth (raw API key still wins), so `anthropic/*` selections run on pi-ai's built-in provider with Claude Code OAuth headers; the model picker advertises `anthropic` for OAuth users; explicit `pi-claude-cli` and raw `ANTHROPIC_API_KEY` remain separate surfaces.
