import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { createTaskStoreTestHarness } from "./store-test-helpers.js";

describe("TaskStore collision guards", () => {
  const harness = createTaskStoreTestHarness();
  let store = harness.store();
  let rootDir = harness.rootDir();

  beforeEach(async () => {
    await harness.beforeEach();
    store = harness.store();
    rootDir = harness.rootDir();
  });

  afterEach(async () => {
    await harness.afterEach();
    vi.restoreAllMocks();
  });

  const forceAllocatorCollision = (taskId: string) => {
    const allocator = store.getDistributedTaskIdAllocator();
    vi.spyOn(allocator, "reserveDistributedTaskId").mockResolvedValue({
      reservationId: `res-${taskId}`,
      taskId,
      sequence: Number.parseInt(taskId.split("-")[1] ?? "0", 10),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      committedClusterTaskCount: 0,
    });
    vi.spyOn(allocator, "commitDistributedTaskIdReservation").mockResolvedValue({
      reservationId: `res-${taskId}`,
      taskId,
      sequence: Number.parseInt(taskId.split("-")[1] ?? "0", 10),
      committedAt: new Date().toISOString(),
      committedClusterTaskCount: 1,
    });
    vi.spyOn(allocator, "abortDistributedTaskIdReservation").mockResolvedValue({
      reservationId: `res-${taskId}`,
      taskId,
      sequence: Number.parseInt(taskId.split("-")[1] ?? "0", 10),
      abortedAt: new Date().toISOString(),
      committedClusterTaskCount: 0,
      reason: "failed-create",
    });
  };

  it("createTask throws and preserves the existing task when the allocator returns a colliding id", async () => {
    const original = await store.createTask({ title: "Original", description: "original task", column: "todo" });
    const originalPromptPath = join(rootDir, ".fusion", "tasks", original.id, "PROMPT.md");
    const originalPrompt = await readFile(originalPromptPath, "utf8");

    forceAllocatorCollision(original.id);
    await expect(
      store.createTask({ title: "Replacement", description: "replacement task", column: "todo" }),
    ).rejects.toThrow(`Task ID already exists: ${original.id}`);

    const persisted = await store.getTask(original.id);
    const promptAfter = await readFile(originalPromptPath, "utf8");

    expect(persisted.title).toBe("Original");
    expect(persisted.description).toBe("original task");
    expect(promptAfter).toBe(originalPrompt);
  });

  it("duplicateTask throws and preserves the unrelated task when its reserved id collides", async () => {
    const source = await store.createTask({ title: "Source", description: "source task" });
    const victim = await store.createTask({ title: "Victim", description: "victim task", column: "todo" });

    forceAllocatorCollision(victim.id);
    await expect(store.duplicateTask(source.id)).rejects.toThrow(`Task ID already exists: ${victim.id}`);

    const persisted = await store.getTask(victim.id);
    expect(persisted.title).toBe("Victim");
    expect(persisted.description).toBe("victim task");
    expect(persisted.sourceParentTaskId).toBeUndefined();
  });

  it("refineTask throws and preserves the unrelated task when its reserved id collides", async () => {
    const source = await store.createTask({ title: "Source", description: "source task", column: "todo" });
    await store.moveTask(source.id, "in-progress");
    await store.moveTask(source.id, "in-review");
    await store.moveTask(source.id, "done");
    const victim = await store.createTask({ title: "Victim", description: "victim task", column: "todo" });

    forceAllocatorCollision(victim.id);
    await expect(store.refineTask(source.id, "apply polish")).rejects.toThrow(`Task ID already exists: ${victim.id}`);

    const persisted = await store.getTask(victim.id);
    expect(persisted.title).toBe("Victim");
    expect(persisted.description).toBe("victim task");
    expect(persisted.dependencies).toEqual([]);
  });

  it("createTask rejects archived-id collisions from stale distributed_task_id_state without overwriting archive data", async () => {
    const archived = await store.createTask({ title: "Archived", description: "archived task", column: "todo" });
    await store.moveTask(archived.id, "in-progress");
    await store.moveTask(archived.id, "in-review");
    await store.moveTask(archived.id, "done");
    const archivedDetail = await store.getTask(archived.id);
    await store.archiveTask(archived.id);

    const archivedPrefix = archived.id.split("-")[0];
    store.getDatabase().prepare("DELETE FROM distributed_task_id_reservations WHERE prefix = ?").run(archivedPrefix);
    store.getDatabase().prepare("UPDATE distributed_task_id_state SET nextSequence = 1 WHERE prefix = ?").run(archivedPrefix);

    await expect(store.createTask({ title: "New", description: "new task" })).rejects.toThrow(
      `Task ID already exists: ${archived.id}`,
    );

    const preservedArchive = await store.getTask(archived.id);
    expect(preservedArchive.title).toBe(archivedDetail.title);
    expect(preservedArchive.description).toBe(archivedDetail.description);
    expect(preservedArchive.prompt).toBe(archivedDetail.prompt);
  });
});
