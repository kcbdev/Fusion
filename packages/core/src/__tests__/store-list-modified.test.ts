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

  it("returns an empty array for an empty store", async () => {
    const changes = await store.listTasksModifiedSince("2026-01-01T00:00:00.000Z", 50);
    expect(changes).toEqual([]);
  });

  it("returns no rows when all updatedAt are <= since", async () => {
    await createTaskWithUpdatedAt("FN-1", "2026-01-01T00:00:00.000Z");
    await createTaskWithUpdatedAt("FN-2", "2026-01-01T00:00:00.500Z");

    const changes = await store.listTasksModifiedSince("2026-01-01T00:00:00.500Z", 50);
    expect(changes).toEqual([]);
  });

  it("uses a strict greater-than cursor boundary", async () => {
    const since = "2026-01-01T00:00:00.000Z";
    await createTaskWithUpdatedAt("FN-1", since);
    await createTaskWithUpdatedAt("FN-2", "2026-01-01T00:00:00.001Z");

    const changes = await store.listTasksModifiedSince(since, 50);
    expect(changes.map((task) => task.id)).toEqual(["FN-2"]);
  });

  it("returns tasks in updatedAt ascending order", async () => {
    await createTaskWithUpdatedAt("FN-1", "2026-01-01T00:00:00.003Z");
    await createTaskWithUpdatedAt("FN-2", "2026-01-01T00:00:00.001Z");
    await createTaskWithUpdatedAt("FN-3", "2026-01-01T00:00:00.002Z");

    const changes = await store.listTasksModifiedSince("2026-01-01T00:00:00.000Z", 50);
    expect(changes.map((task) => task.id)).toEqual(["FN-2", "FN-3", "FN-1"]);
    expect(changes.map((task) => task.updatedAt)).toEqual([
      "2026-01-01T00:00:00.001Z",
      "2026-01-01T00:00:00.002Z",
      "2026-01-01T00:00:00.003Z",
    ]);
  });

  it("applies the limit cap to earliest modified tasks", async () => {
    for (let i = 1; i <= 5; i += 1) {
      await createTaskWithUpdatedAt(`FN-${i}`, `2026-01-01T00:00:00.00${i}Z`);
    }

    const changes = await store.listTasksModifiedSince("2026-01-01T00:00:00.000Z", 2);
    expect(changes.map((task) => task.id)).toEqual(["FN-1", "FN-2"]);
  });

  it.each([
    ["limit=0", "2026-01-01T00:00:00.000Z", 0, "finite positive integer"],
    ["limit=-1", "2026-01-01T00:00:00.000Z", -1, "finite positive integer"],
    ["limit=201", "2026-01-01T00:00:00.000Z", 201, "less than or equal to 200"],
    ["limit non-numeric", "2026-01-01T00:00:00.000Z", Number.NaN, "finite positive integer"],
    ["since non-string", 123 as unknown as string, 50, "since must be a non-empty string"],
    ["since empty", "", 50, "since must be a non-empty string"],
  ])("validates inputs: %s", async (_name, since, limit, message) => {
    await expect(store.listTasksModifiedSince(since, limit as number)).rejects.toThrow(TypeError);
    await expect(store.listTasksModifiedSince(since, limit as number)).rejects.toThrow(message);
  });

  it("applies slim mode log stripping and timedExecution aggregation", async () => {
    await createTaskWithUpdatedAt("FN-1", "2026-01-01T00:00:00.000Z");
    await store.logEntry("FN-1", "[timing] Step finished in 123ms");

    const full = await store.listTasksModifiedSince("2026-01-01T00:00:00.000Z", 50);
    expect(full).toHaveLength(1);
    expect(full[0]?.log.length).toBeGreaterThan(0);

    const slim = await store.listTasksModifiedSince("2026-01-01T00:00:00.000Z", 50, { slim: true });
    expect(slim).toHaveLength(1);
    expect(slim[0]?.log).toEqual([]);
    expect(typeof slim[0]?.timedExecutionMs).toBe("number");
    expect(slim[0]?.timedExecutionMs).toBeGreaterThan(0);
  });

  it("excludes archived-column tasks", async () => {
    await createTaskWithUpdatedAt("FN-1", "2026-01-01T00:00:00.001Z");
    await createTaskWithUpdatedAt("FN-2", "2026-01-01T00:00:00.002Z", "archived");

    const changes = await store.listTasksModifiedSince("2026-01-01T00:00:00.000Z", 50);
    expect(changes.map((task) => task.id)).toEqual(["FN-1"]);
  });
});
