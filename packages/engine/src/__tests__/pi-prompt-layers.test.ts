import { describe, it, expect } from "vitest";

describe("createFnAgent prompt layer configuration", () => {
  it("uses stable layer as systemPromptOverride when layers provided", () => {
    const options = {
      systemPrompt: "Stable.\n\nDynamic.",
      systemPromptLayers: { stable: "Stable.", dynamic: "Dynamic." },
    };

    const systemPromptOverride =
      options.systemPromptLayers?.stable ?? options.systemPrompt;
    const appendSystemPromptOverride = options.systemPromptLayers?.dynamic
      ? [options.systemPromptLayers.dynamic]
      : [];

    expect(systemPromptOverride).toBe("Stable.");
    expect(appendSystemPromptOverride).toEqual(["Dynamic."]);
  });

  it("falls back to full systemPrompt when layers not provided", () => {
    const options = {
      systemPrompt: "Full prompt.",
      systemPromptLayers: undefined as
        | { stable: string; dynamic: string }
        | undefined,
    };

    const systemPromptOverride =
      options.systemPromptLayers?.stable ?? options.systemPrompt;
    const appendSystemPromptOverride = options.systemPromptLayers?.dynamic
      ? [options.systemPromptLayers.dynamic]
      : [];

    expect(systemPromptOverride).toBe("Full prompt.");
    expect(appendSystemPromptOverride).toEqual([]);
  });

  it("handles empty dynamic layer", () => {
    const options = {
      systemPrompt: "Stable.",
      systemPromptLayers: { stable: "Stable.", dynamic: "" },
    };

    const systemPromptOverride =
      options.systemPromptLayers?.stable ?? options.systemPrompt;
    const appendSystemPromptOverride = options.systemPromptLayers?.dynamic
      ? [options.systemPromptLayers.dynamic]
      : [];

    expect(systemPromptOverride).toBe("Stable.");
    expect(appendSystemPromptOverride).toEqual([]);
  });
});
