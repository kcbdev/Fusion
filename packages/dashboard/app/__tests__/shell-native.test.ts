import { describe, expect, it, vi } from "vitest";
import { getShellConnectionNativeResult } from "../shell-native";

describe("shell-native", () => {
  it("returns unsupported browser fallback", async () => {
    const result = await getShellConnectionNativeResult({ kind: "browser" }, window);
    expect(result.hostKind).toBe("browser");
    expect(result.available).toBe(false);
    await expect(result.openConnectionManager()).resolves.toEqual({ ok: false, reason: "unsupported" });
  });

  it("returns unsupported for mobile shell without bridge", async () => {
    const result = await getShellConnectionNativeResult({ kind: "mobile-shell", mode: "remote" }, window);
    expect(result.available).toBe(false);
    await expect(result.openConnectionManager()).resolves.toEqual({ ok: false, reason: "unsupported" });
  });

  it("uses desktop fusionAPI connection manager", async () => {
    const openConnectionManager = vi.fn(async () => undefined);
    const target = {
      ...window,
      fusionAPI: { openConnectionManager },
    } as Window & typeof globalThis & { fusionAPI: { openConnectionManager: () => Promise<void> } };

    const result = await getShellConnectionNativeResult({ kind: "desktop-shell", mode: "local" }, target);
    expect(result.available).toBe(true);
    await expect(result.openConnectionManager()).resolves.toEqual({ ok: true });
    expect(openConnectionManager).toHaveBeenCalledTimes(1);
  });

  it("uses mobile fusionShell capability and extracts metadata", async () => {
    const openConnectionManager = vi.fn(async () => undefined);
    const target = {
      ...window,
      fusionShell: {
        openConnectionManager,
        getState: vi.fn(async () => ({
          host: "mobile-shell",
          activeProfileId: "p1",
          profiles: [{ id: "p1", name: "Remote 1", serverUrl: "https://fusion.example.com/root", createdAt: "", updatedAt: "" }],
        })),
      },
    } as unknown as Window & typeof globalThis;

    const result = await getShellConnectionNativeResult(
      { kind: "mobile-shell", mode: "remote", connectionId: "p1", serverUrl: "https://fusion.example.com/root" },
      target,
    );

    expect(result.available).toBe(true);
    expect(result.profileId).toBe("p1");
    expect(result.profileLabel).toBe("Remote 1");
    expect(result.serverOrigin).toBe("https://fusion.example.com");
    await expect(result.openConnectionManager()).resolves.toEqual({ ok: true });
  });

  it("surfaces invocation failures", async () => {
    const target = {
      ...window,
      fusionAPI: {
        openConnectionManager: vi.fn(async () => {
          throw new Error("boom");
        }),
      },
    } as Window & typeof globalThis;

    const result = await getShellConnectionNativeResult({ kind: "desktop-shell", mode: "remote" }, target);
    await expect(result.openConnectionManager()).resolves.toEqual({ ok: false, reason: "failed", error: "boom" });
  });
});
