/**
 * OpenClaw Runtime Plugin
 *
 * Registers an experimental OpenClaw runtime with Fusion's plugin runtime
 * discovery pipeline. Runtime execution behavior is intentionally deferred.
 */

import { definePlugin } from "@fusion/plugin-sdk";
import type {
  FusionPlugin,
  PluginContext,
  PluginRuntimeFactory,
  PluginRuntimeManifestMetadata,
} from "@fusion/plugin-sdk";

const OPENCLAW_RUNTIME_ID = "openclaw";
const OPENCLAW_RUNTIME_VERSION = "0.1.0";

const openclawRuntimeMetadata: PluginRuntimeManifestMetadata = {
  runtimeId: OPENCLAW_RUNTIME_ID,
  name: "OpenClaw Runtime",
  description: "Experimental OpenClaw runtime integration for Fusion tasks (execution deferred)",
  version: OPENCLAW_RUNTIME_VERSION,
};

const openclawRuntimeFactory: PluginRuntimeFactory = (_ctx: PluginContext) => {
  return {
    runtimeId: OPENCLAW_RUNTIME_ID,
    version: OPENCLAW_RUNTIME_VERSION,
    status: "deferred",
    message:
      "OpenClaw runtime execution is currently deferred. This runtime is registered for discovery and configuration only.",
    execute: async () => {
      throw new Error(
        "OpenClaw runtime is not implemented yet. Runtime discovery and configuration are supported, but execution is deferred.",
      );
    },
  };
};

const plugin: FusionPlugin = definePlugin({
  manifest: {
    id: "fusion-plugin-openclaw-runtime",
    name: "OpenClaw Runtime Plugin",
    version: "0.1.0",
    description: "OpenClaw runtime plugin for Fusion with experimental deferred execution",
    author: "Fusion Team",
    homepage: "https://github.com/gsxdsm/fusion",
    runtime: openclawRuntimeMetadata,
  },
  state: "installed",
  hooks: {
    onLoad: (ctx) => {
      ctx.logger.info("OpenClaw Runtime Plugin loaded (experimental placeholder runtime)");
      ctx.emitEvent("openclaw-runtime:loaded", {
        runtimeId: OPENCLAW_RUNTIME_ID,
        version: OPENCLAW_RUNTIME_VERSION,
        status: "deferred",
      });
    },
    onUnload: () => {
      // No context available during unload
    },
  },
  runtime: {
    metadata: openclawRuntimeMetadata,
    factory: openclawRuntimeFactory,
  },
});

export default plugin;

export { openclawRuntimeMetadata, openclawRuntimeFactory, OPENCLAW_RUNTIME_ID };
