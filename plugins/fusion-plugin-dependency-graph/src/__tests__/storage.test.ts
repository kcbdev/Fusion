import { describe, expect, it, beforeEach } from "vitest";
import { projectScopedKey, loadPositions, savePositions } from "../storage";

const createMemoryStorage = () => {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    clear: () => map.clear(),
  };
};

describe("storage", () => {
  const localStorage = createMemoryStorage();

  beforeEach(() => {
    (globalThis as { window?: { localStorage?: typeof localStorage } }).window = { localStorage };
    localStorage.clear();
  });

  it("builds project-scoped key with canonical base key", () => {
    expect(projectScopedKey("proj_123")).toBe("kb:proj_123:fusion-plugin-dependency-graph:positions");
  });

  it("falls back to unscoped key when projectId is missing or empty", () => {
    expect(projectScopedKey()).toBe("fusion-plugin-dependency-graph:positions");
    expect(projectScopedKey("")).toBe("fusion-plugin-dependency-graph:positions");
  });

  it("persists and restores positions", () => {
    savePositions("proj_123", { "FN-1": { x: 10, y: 20 } });
    expect(loadPositions("proj_123")).toEqual({ "FN-1": { x: 10, y: 20 } });
  });

  it("returns empty object for invalid JSON", () => {
    localStorage.setItem("kb:proj_123:fusion-plugin-dependency-graph:positions", "not-json");
    expect(loadPositions("proj_123")).toEqual({});
  });
});
