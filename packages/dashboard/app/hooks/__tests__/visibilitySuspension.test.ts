import { act, fireEvent, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { isLikelyTabSuspensionError, useTabVisibilitySuspension } from "../visibilitySuspension";

describe("visibilitySuspension", () => {
  it.each([
    "Load failed",
    "Failed to fetch",
    "NetworkError when attempting to fetch resource.",
    "Connection aborted",
    "Connection closed unexpectedly",
    "network error",
  ])("matches known tab-suspension transport errors: %s", (message) => {
    expect(isLikelyTabSuspensionError(message)).toBe(true);
  });

  it("rejects unrelated backend errors", () => {
    expect(isLikelyTabSuspensionError("Request failed: 500")).toBe(false);
    expect(isLikelyTabSuspensionError("Validation error: missing key")).toBe(false);
  });

  it("tracks recently hidden window", () => {
    vi.useFakeTimers();

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    const { result } = renderHook(() => useTabVisibilitySuspension());

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    act(() => {
      fireEvent(document, new Event("visibilitychange"));
    });

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    act(() => {
      fireEvent(document, new Event("visibilitychange"));
    });

    expect(result.current.wasRecentlyHidden(5000)).toBe(true);

    act(() => {
      vi.advanceTimersByTime(6000);
    });

    expect(result.current.wasRecentlyHidden(5000)).toBe(false);

    vi.useRealTimers();
  });
});
