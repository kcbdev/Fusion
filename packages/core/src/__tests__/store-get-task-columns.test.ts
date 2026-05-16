import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTaskStoreTestHarness } from "./store-test-helpers.js";

describe("TaskStore.getTaskColumns", () => {
  const harness = createTaskStoreTestHarness();

  beforeEach(async () => {
    await harness.beforeEach();
  });

  afterEach(async () => {
    await harness.afterEach();
  });

  it("returns empty map for empty input", async () => {
    const store = harness.store();
    const prepareSpy = vi.spyOn((store as any).db, "prepare");

    const result = await store.getTaskColumns([]);

    expect(result.size).toBe(0);
    expect(prepareSpy).not.toHaveBeenCalled();
  });

  it("returns columns for active tasks", async () => {
    const store = harness.store();
    const one = await harness.createTestTask();
    const two = await harness.createTestTask();
    await store.moveTask(two.id, "todo");
    await store.moveTask(two.id, "in-progress");

    const result = await store.getTaskColumns([one.id, two.id]);

    expect(result.get(one.id)).toBe("triage");
    expect(result.get(two.id)).toBe("in-progress");
  });

  it("maps archived tasks to archived column", async () => {
    const store = harness.store();
    const task = await harness.createTestTask();
    await store.moveTask(task.id, "todo");
    await store.moveTask(task.id, "in-progress");
    await store.moveTask(task.id, "in-review");
    await store.moveTask(task.id, "done");
    await store.archiveTask(task.id);

    const result = await store.getTaskColumns([task.id]);

    expect(result.get(task.id)).toBe("archived");
  });

  it("handles mixed active, archived, and unknown ids", async () => {
    const store = harness.store();
    const active = await harness.createTestTask();
    const archived = await harness.createTestTask();
    await store.moveTask(archived.id, "todo");
    await store.moveTask(archived.id, "in-progress");
    await store.moveTask(archived.id, "in-review");
    await store.moveTask(archived.id, "done");
    await store.archiveTask(archived.id);

    const result = await store.getTaskColumns([active.id, archived.id, "FN-DOES-NOT-EXIST"]);

    expect(result.get(active.id)).toBe("triage");
    expect(result.get(archived.id)).toBe("archived");
    expect(result.has("FN-DOES-NOT-EXIST")).toBe(false);
  });

  it("queries live tasks once for large batches", async () => {
    const store = harness.store();
    const tasks = await Promise.all(Array.from({ length: 120 }, () => harness.createTestTask()));
    const ids = tasks.map((task) => task.id);

    const prepareSpy = vi.spyOn((store as any).db, "prepare");
    const result = await store.getTaskColumns(ids);

    const liveColumnQueryCalls = prepareSpy.mock.calls.filter(([sql]) =>
      typeof sql === "string" && sql.includes('SELECT id, "column" FROM tasks WHERE id IN ('),
    );

    expect(result.size).toBe(ids.length);
    expect(liveColumnQueryCalls).toHaveLength(1);
  });
});
