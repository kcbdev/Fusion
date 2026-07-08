---
"@runfusion/fusion": minor
---

summary: Custom providers can now enable Anthropic-style prompt caching to stop re-billing the full context each turn.
category: fix
dev: Sets pi-ai `compat.cacheControlFormat="anthropic"` on opted-in custom-provider models across both registration paths (custom-provider-registry `toProviderConfig` and `pi.ts` createFnAgent). Opt-in via new `CustomProvider.anthropicPromptCaching` flag (FN-7689).
