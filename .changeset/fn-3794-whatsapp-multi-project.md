---
"@runfusion/fusion": patch
---

Fix a multi-project collision in the bundled WhatsApp plugin by keying connections with `getRootDir() + "::" + pluginId`, so concurrent projects no longer share a single connection state.

Update the plugin SDK hook type so `onUnload` now receives `PluginContext` (matching `onLoad`). This is backward-compatible at runtime, but plugin authors may need to update TypeScript signatures.
