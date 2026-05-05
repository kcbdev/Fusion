import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  content: new Map<string, string>(),
}));

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => "/tmp/fusion"),
  },
}));

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(async (path: string) => {
    const value = mockState.content.get(path);
    if (!value) {
      const err = new Error("ENOENT") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    }
    return value;
  }),
  writeFile: vi.fn(async (path: string, value: string) => {
    mockState.content.set(path, value);
  }),
  rename: vi.fn(async (from: string, to: string) => {
    const value = mockState.content.get(from) ?? "";
    mockState.content.set(to, value);
  }),
}));

describe("shell-settings", () => {
  beforeEach(() => {
    mockState.content.clear();
    vi.resetModules();
  });

  it("returns defaults when file missing", async () => {
    const { readShellSettings } = await import("../shell-settings.ts");
    await expect(readShellSettings()).resolves.toEqual({
      desktopMode: "remote",
      activeProfileId: null,
      profiles: [],
    });
  });

  it("writes and reads persisted settings", async () => {
    const { writeShellSettings, readShellSettings } = await import("../shell-settings.ts");

    await writeShellSettings({
      desktopMode: "local",
      activeProfileId: "p1",
      profiles: [
        {
          id: "p1",
          name: "Local",
          serverUrl: "http://127.0.0.1",
          authToken: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          lastUsedAt: null,
        },
      ],
    });

    await expect(readShellSettings()).resolves.toMatchObject({
      desktopMode: "local",
      activeProfileId: "p1",
      profiles: [{ id: "p1" }],
    });
  });
});
