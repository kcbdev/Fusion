import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useViewportMode } from "../useViewportMode";

describe("useViewportMode", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("supports legacy MediaQueryList listeners without runtime errors", () => {
    const listeners: Array<() => void> = [];
    const removeListener = vi.fn((listener: () => void) => {
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: query === "(max-width: 768px)",
        media: query,
        onchange: null,
        addListener: (listener: () => void) => listeners.push(listener),
        removeListener,
      })),
    );

    renderHook(() => useViewportMode());

    expect(consoleErrorSpy).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});
