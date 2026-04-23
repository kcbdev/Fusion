/**
 * OpenClaw Runtime Plugin
 *
 * Registers an experimental OpenClaw runtime with Fusion's plugin runtime
 * discovery pipeline. Runtime execution behavior is intentionally deferred.
 */
import type { FusionPlugin, PluginRuntimeFactory, PluginRuntimeManifestMetadata } from "@fusion/plugin-sdk";
declare const OPENCLAW_RUNTIME_ID = "openclaw";
declare const openclawRuntimeMetadata: PluginRuntimeManifestMetadata;
declare const openclawRuntimeFactory: PluginRuntimeFactory;
declare const plugin: FusionPlugin;
export default plugin;
export { openclawRuntimeMetadata, openclawRuntimeFactory, OPENCLAW_RUNTIME_ID };
//# sourceMappingURL=index.d.ts.map