import { beforeEach, describe, expect, it, vi } from "vitest";

import { SWR_CACHE_KEYS, clearCache, readCache, writeCache } from "../swrCache";

describe("swrCache", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("returns null on cache miss", () => {
    expect(readCache("missing")).toBeNull();
  });

  it("writes and reads cache payload", () => {
    const payload = { value: "ok", count: 2 };
    writeCache("demo", payload);

    expect(readCache<typeof payload>("demo")).toEqual(payload);
  });

  it("does not write when payload exceeds maxBytes", () => {
    writeCache("large", { value: "0123456789" }, { maxBytes: 5 });

    expect(localStorage.getItem("large")).toBeNull();
  });

  it("clearCache removes only matching prefix keys", () => {
    const backing = new Map<string, string>();
    const storage = {
      get length() {
        return backing.size;
      },
      key: (index: number) => Array.from(backing.keys())[index] ?? null,
      getItem: (key: string) => backing.get(key) ?? null,
      setItem: (key: string, value: string) => {
        backing.set(key, value);
      },
      removeItem: (key: string) => {
        backing.delete(key);
      },
      clear: () => {
        backing.clear();
      },
    } satisfies Storage;

    vi.stubGlobal("localStorage", storage);

    writeCache(`${SWR_CACHE_KEYS.TASKS_PREFIX}a`, [{ id: "1" }]);
    writeCache(`${SWR_CACHE_KEYS.TASKS_PREFIX}b`, [{ id: "2" }]);
    writeCache(SWR_CACHE_KEYS.PROJECTS, [{ id: "p" }]);

    clearCache(SWR_CACHE_KEYS.TASKS_PREFIX);

    expect(readCache(`${SWR_CACHE_KEYS.TASKS_PREFIX}a`)).toBeNull();
    expect(readCache(`${SWR_CACHE_KEYS.TASKS_PREFIX}b`)).toBeNull();
    expect(readCache(SWR_CACHE_KEYS.PROJECTS)).toEqual([{ id: "p" }]);
  });

  it("swallows quota errors", () => {
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });

    expect(() => writeCache("quota", { ok: true })).not.toThrow();
  });
});
