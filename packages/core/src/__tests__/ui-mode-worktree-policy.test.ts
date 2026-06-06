import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GlobalSettingsStore } from "../global-settings.js";
import { DEFAULT_GLOBAL_SETTINGS, DEFAULT_PROJECT_SETTINGS } from "../types.js";
import { resolveUiMode } from "../ui-mode.js";
import { resolveWorktreeEnabled, isWorktreeForcedOnBySimpleMode } from "../worktree-policy.js";

describe("uiMode setting (U11)", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  it("defaults to simple in the schema", () => {
    expect(DEFAULT_GLOBAL_SETTINGS.uiMode).toBe("simple");
    expect(DEFAULT_GLOBAL_SETTINGS.worktreeIsolationEnabled).toBe(true);
    // Project override is opt-in only (undefined → inherit global).
    expect(DEFAULT_PROJECT_SETTINGS.worktreeIsolationEnabled).toBeUndefined();
  });

  it("hydrates to simple when unset and persists an explicit advanced choice", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fn-uimode-test-"));
    dirs.push(dir);

    const store = new GlobalSettingsStore(dir);
    await store.init();

    const fresh = await store.getSettings();
    expect(fresh.uiMode).toBe("simple");

    await store.updateSettings({ uiMode: "advanced" });

    // New store instance reads from disk (no in-memory cache leakage).
    const reloaded = await new GlobalSettingsStore(dir).getSettings();
    expect(reloaded.uiMode).toBe("advanced");
  });

  it("resolveUiMode defaults unknown/missing values to simple", () => {
    expect(resolveUiMode(undefined)).toBe("simple");
    expect(resolveUiMode({})).toBe("simple");
    expect(resolveUiMode({ uiMode: "simple" })).toBe("simple");
    expect(resolveUiMode({ uiMode: "advanced" })).toBe("advanced");
    // Defensive: garbage stored value falls back to the gated default.
    expect(resolveUiMode({ uiMode: "nonsense" as never })).toBe("simple");
  });
});

describe("resolveWorktreeEnabled matrix (U11, R23)", () => {
  it("simple + stored-disabled → forced on (true)", () => {
    expect(
      resolveWorktreeEnabled({ globalSettings: { uiMode: "simple", worktreeIsolationEnabled: false } }),
    ).toBe(true);
  });

  it("simple + stored-enabled → true", () => {
    expect(
      resolveWorktreeEnabled({ globalSettings: { uiMode: "simple", worktreeIsolationEnabled: true } }),
    ).toBe(true);
  });

  it("simple + project-disabled → forced on (true)", () => {
    expect(
      resolveWorktreeEnabled({
        globalSettings: { uiMode: "simple", worktreeIsolationEnabled: true },
        projectSettings: { worktreeIsolationEnabled: false },
      }),
    ).toBe(true);
  });

  it("advanced + stored-disabled → false (opt-out honored)", () => {
    expect(
      resolveWorktreeEnabled({ globalSettings: { uiMode: "advanced", worktreeIsolationEnabled: false } }),
    ).toBe(false);
  });

  it("advanced + stored-enabled → true", () => {
    expect(
      resolveWorktreeEnabled({ globalSettings: { uiMode: "advanced", worktreeIsolationEnabled: true } }),
    ).toBe(true);
  });

  it("advanced: project value takes precedence over global", () => {
    // Global disabled, project explicitly enabled → enabled.
    expect(
      resolveWorktreeEnabled({
        globalSettings: { uiMode: "advanced", worktreeIsolationEnabled: false },
        projectSettings: { worktreeIsolationEnabled: true },
      }),
    ).toBe(true);
    // Global enabled, project explicitly disabled → disabled.
    expect(
      resolveWorktreeEnabled({
        globalSettings: { uiMode: "advanced", worktreeIsolationEnabled: true },
        projectSettings: { worktreeIsolationEnabled: false },
      }),
    ).toBe(false);
  });

  it("advanced + nothing stored → defaults enabled (true)", () => {
    expect(resolveWorktreeEnabled({ globalSettings: { uiMode: "advanced" } })).toBe(true);
    expect(resolveWorktreeEnabled({ globalSettings: undefined })).toBe(true);
  });

  it("missing uiMode defaults to simple → always forced on", () => {
    expect(resolveWorktreeEnabled({ globalSettings: { worktreeIsolationEnabled: false } })).toBe(true);
  });
});

describe("isWorktreeForcedOnBySimpleMode (U11, R23 one-time notice trigger)", () => {
  it("true only when simple mode overrides an explicit stored disable", () => {
    expect(
      isWorktreeForcedOnBySimpleMode({ globalSettings: { uiMode: "simple", worktreeIsolationEnabled: false } }),
    ).toBe(true);
    expect(
      isWorktreeForcedOnBySimpleMode({
        globalSettings: { uiMode: "simple", worktreeIsolationEnabled: true },
        projectSettings: { worktreeIsolationEnabled: false },
      }),
    ).toBe(true);
  });

  it("false when nothing is being overridden", () => {
    // Simple but stored already enabled → no override happening.
    expect(
      isWorktreeForcedOnBySimpleMode({ globalSettings: { uiMode: "simple", worktreeIsolationEnabled: true } }),
    ).toBe(false);
    // Simple, nothing stored → default-enabled, no override.
    expect(isWorktreeForcedOnBySimpleMode({ globalSettings: { uiMode: "simple" } })).toBe(false);
    // Advanced → force-on never applies.
    expect(
      isWorktreeForcedOnBySimpleMode({ globalSettings: { uiMode: "advanced", worktreeIsolationEnabled: false } }),
    ).toBe(false);
  });
});
