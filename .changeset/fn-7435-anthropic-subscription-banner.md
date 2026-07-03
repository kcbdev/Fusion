---
"@runfusion/fusion": patch
---

summary: Suppress misleading Anthropic Subscription re-login banners when another Anthropic auth method is active.
category: fix
dev: Keeps subscription OAuth expired in Settings while hiding only the global urgent banner entry when API key or Claude CLI auth is active.
