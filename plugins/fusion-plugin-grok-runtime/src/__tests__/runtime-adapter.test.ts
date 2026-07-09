import { describe, expect, it } from "vitest";
import { GrokRuntimeAdapter } from "../runtime-adapter.js";

describe("GrokRuntimeAdapter", () => {
  it("creates a session with default model fallback", async () => {
    const adapter = new GrokRuntimeAdapter();
    const result = await adapter.createSession({ systemPrompt: "sys" });
    expect(result.session.model).toBe("grok/default");
    expect(result.session.systemPrompt).toBe("sys");
  });

  // FN-7715: promptWithFallback is an INTENTIONAL no-op — Grok streaming
  // flows through the pi/xAI OpenAI-compatible path registered by FN-7711,
  // not through this plugin runtime adapter (which is only reached via
  // runtimeConfig.runtimeHint === "grok", which nothing in the product
  // sets). This module imports no process-spawning seam (compare
  // process-manager.ts's `runGrokCommand`), so this asserts the intentional
  // no-op contract at the only observable boundary: it resolves without
  // throwing and returns no value, taking no action.
  it("promptWithFallback is an intentional no-op: resolves without throwing, returns undefined", async () => {
    const adapter = new GrokRuntimeAdapter();

    await expect(adapter.promptWithFallback()).resolves.toBeUndefined();
  });

  it("describeModel formats grok prefix", () => {
    const adapter = new GrokRuntimeAdapter();
    expect(adapter.describeModel({ model: "grok/pro" })).toBe("grok/grok/pro");
  });
});
