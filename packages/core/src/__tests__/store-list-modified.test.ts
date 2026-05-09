import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { TaskStore } from "../store.js";

describe("TaskStore.listTasksModifiedSince", () => {
  let rootDir: string;
  let globalDir: string;
  let store: TaskStore;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "store-list-modified-"));
    globalDir = join(rootDir, ".fusion-global-settings");
    store = new TaskStore(rootDir, globalDir, { inMemoryDb: true });
    await store.init();
  });

  afterEach(async () => {
    await store.close();
    await rm(rootDir, { recursive: true, force: true });
  });

  async function createTaskWithUpdatedAt(id: string, updatedAt: string, column: "todo" | "archived" = "todo") {
    return store.createTaskWithReservedId(
      { description: `Task ${id}`, column },
      { taskId: id, createdAt: updatedAt, updatedAt },
    );
  }

  it("returns empty tasks and hasMore false when nothing matches", async () => {
    const result = await store.listTasksModifiedSince("2026-01-01T00:00:00.000Z", 50);
    expect(result).toEqual({ tasks: [], hasMore: false });
  });

  it("returns rows in updatedAt ASC order using strict greater-than cursor", async () => {
    await createTaskWithUpdatedAt("FN-1", "2026-01-01T00:00:00.000Z");
    await createTaskWithUpdatedAt("FN-2", "2026-01-01T00:00:00.002Z");
    await createTaskWithUpdatedAt("FN-3", "2026-01-01T00:00:00.001Z");

    const result = await store.listTasksModifiedSince("2026-01-01T00:00:00.000Z");
    expect(result.hasMore).toBe(false);
    expect(result.tasks.map((task) => task.id)).toEqual(["FN-3", "FN-2"]);
    expect(result.tasks.map((task) => task.updatedAt)).toEqual([
      "2026-01-01T00:00:00.001Z",
      "2026-01-01T00:00:00.002Z",
    ]);
  });

  it("sets hasMore true when trimmed and false when exactly limit rows match", async () => {
    for (let i = 1; i <= 5; i += 1) {
      await createTaskWithUpdatedAt(`FN-${i}`, `2026-01-01T00:00:00.00${i}Z`);
    }

    const trimmed = await store.listTasksModifiedSince("2026-01-01T00:00:00.000Z", 2);
    expect(trimmed.tasks.map((task) => task.id)).toEqual(["FN-1", "FN-2"]);
    expect(trimmed.hasMore).toBe(true);

    const exact = await store.listTasksModifiedSince("2026-01-01T00:00:00.000Z", 5);
    expect(exact.tasks).toHaveLength(5);
    expect(exact.hasMore).toBe(false);
  });

  it("uses default limit 50 and clamps above max to 200", async () => {
    for (let i = 1; i <= 220; i += 1) {
      const padded = i.toString().padStart(3, "0");
      await createTaskWithUpdatedAt(`FN-${i}`, `2026-01-01T00:00:00.${padded}Z`);
    }

    const defaultLimited = await store.listTasksModifiedSince("2026-01-01T00:00:00.000Z", Number.NaN);
    expect(defaultLimited.tasks).toHaveLength(50);
    expect(defaultLimited.hasMore).toBe(true);

    const maxLimited = await store.listTasksModifiedSince("2026-01-01T00:00:00.000Z", 1000);
    expect(maxLimited.tasks).toHaveLength(200);
    expect(maxLimited.hasMore).toBe(true);
  });

  it.each([0, -5])("clamps limit below 1 to 1 (limit=%s)", async (limit) => {
    await createTaskWithUpdatedAt("FN-1", "2026-01-01T00:00:00.001Z");
    await createTaskWithUpdatedAt("FN-2", "2026-01-01T00:00:00.002Z");

    const result = await store.listTasksModifiedSince("2026-01-01T00:00:00.000Z", limit);
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]?.id).toBe("FN-1");
    expect(result.hasMore).toBe(true);
  });

  it.each(["", "not-a-date", "yesterday"])("throws on invalid since cursor: %s", async (since) => {
    await expect(store.listTasksModifiedSince(since, 50)).rejects.toThrow(TypeError);
    await expect(store.listTasksModifiedSince(since, 50)).rejects.toThrow("listTasksModifiedSince: invalid since cursor");
  });

  it("excludes archived tasks by default and includes them when requested", async () => {
    await createTaskWithUpdatedAt("FN-1", "2026-01-01T00:00:00.001Z", "todo");
    await createTaskWithUpdatedAt("FN-2", "2026-01-01T00:00:00.002Z", "archived");

    const excluded = await store.listTasksModifiedSince("2026-01-01T00:00:00.000Z");
    expect(excluded.tasks.map((task) => task.id)).toEqual(["FN-1"]);

    const included = await store.listTasksModifiedSince("2026-01-01T00:00:00.000Z", 50, { includeArchived: true });
    expect(included.tasks.map((task) => task.id)).toEqual(["FN-1", "FN-2"]);
  });

  it("returns slim tasks with no prompt body and empty log", async () => {
    await createTaskWithUpdatedAt("FN-1", "2026-01-01T00:00:00.001Z");
    await store.logEntry("FN-1", "timing marker");

    const result = await store.listTasksModifiedSince("2026-01-01T00:00:00.000Z", 50);
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]?.prompt).toBeUndefined();
    expect(result.tasks[0]?.log).toEqual([]);
  });
});
