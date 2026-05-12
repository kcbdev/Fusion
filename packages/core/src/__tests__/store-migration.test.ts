import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTaskStoreTestHarness } from "./store-test-helpers.js";

describe("TaskStore", () => {
  const harness = createTaskStoreTestHarness();

  beforeEach(harness.beforeEach);
  afterEach(harness.afterEach);

  describe("recovery metadata (recoveryRetryCount / nextRecoveryAt)", () => {
    async function createRecoveryTask() {
      return harness.store().createTask({ description: "recovery test task" });
    }

    it("new tasks have no recovery metadata (defaults to undefined)", async () => {
      const task = await createRecoveryTask();
      expect(task.recoveryRetryCount).toBeUndefined();
      expect(task.nextRecoveryAt).toBeUndefined();
    });

    it("updateTask can set and clear recoveryRetryCount and nextRecoveryAt", async () => {
      const task = await createRecoveryTask();
      const futureTime = new Date(Date.now() + 60_000).toISOString();

      const updated = await harness.store().updateTask(task.id, {
        recoveryRetryCount: 2,
        nextRecoveryAt: futureTime,
      });
      expect(updated.recoveryRetryCount).toBe(2);
      expect(updated.nextRecoveryAt).toBe(futureTime);

      const reread = await harness.store().getTask(task.id);
      expect(reread.recoveryRetryCount).toBe(2);
      expect(reread.nextRecoveryAt).toBe(futureTime);

      const cleared = await harness.store().updateTask(task.id, {
        recoveryRetryCount: null,
        nextRecoveryAt: null,
      });
      expect(cleared.recoveryRetryCount).toBeUndefined();
      expect(cleared.nextRecoveryAt).toBeUndefined();
    });

    it("moveTask to in-review clears recovery metadata", async () => {
      const task = await createRecoveryTask();
      await harness.store().moveTask(task.id, "todo");
      await harness.store().updateTask(task.id, {
        recoveryRetryCount: 3,
        nextRecoveryAt: new Date().toISOString(),
      });
      await harness.store().moveTask(task.id, "in-progress");
      const moved = await harness.store().moveTask(task.id, "in-review");
      expect(moved.recoveryRetryCount).toBeUndefined();
      expect(moved.nextRecoveryAt).toBeUndefined();
    });

    it("moveTask to done clears recovery metadata", async () => {
      const task = await createRecoveryTask();
      await harness.store().moveTask(task.id, "todo");
      await harness.store().updateTask(task.id, {
        recoveryRetryCount: 1,
        nextRecoveryAt: new Date().toISOString(),
      });
      await harness.store().moveTask(task.id, "in-progress");
      await harness.store().moveTask(task.id, "in-review");
      const done = await harness.store().moveTask(task.id, "done");
      expect(done.recoveryRetryCount).toBeUndefined();
      expect(done.nextRecoveryAt).toBeUndefined();
    });

    it("moveTask from in-progress to todo preserves recovery metadata", async () => {
      const task = await createRecoveryTask();
      await harness.store().moveTask(task.id, "todo");
      await harness.store().moveTask(task.id, "in-progress");

      const futureTime = new Date(Date.now() + 60_000).toISOString();
      await harness.store().updateTask(task.id, {
        recoveryRetryCount: 2,
        nextRecoveryAt: futureTime,
      });

      const moved = await harness.store().moveTask(task.id, "todo");
      expect(moved.recoveryRetryCount).toBe(2);
      expect(moved.nextRecoveryAt).toBe(futureTime);
    });

    it("recovery metadata persists across store re-initialization", async () => {
      await harness.reopenDiskBackedStore();

      const task = await createRecoveryTask();
      const futureTime = new Date(Date.now() + 60_000).toISOString();
      await harness.store().updateTask(task.id, {
        recoveryRetryCount: 5,
        nextRecoveryAt: futureTime,
      });

      await harness.reopenDiskBackedStore();

      const reloaded = await harness.store().getTask(task.id);
      expect(reloaded.recoveryRetryCount).toBe(5);
      expect(reloaded.nextRecoveryAt).toBe(futureTime);
    });

    it("schema migration: existing rows default to NULL (undefined) for recovery fields", async () => {
      const task = await createRecoveryTask();
      const detail = await harness.store().getTask(task.id);
      expect(detail.recoveryRetryCount).toBeUndefined();
      expect(detail.nextRecoveryAt).toBeUndefined();
    });
  });

  describe("FTS5 corruption recovery during create inserts", () => {
    it("rebuilds FTS5 and retries once when an insert fails with an FTS corruption error", async () => {
      const db = harness.store().getDatabase();
      const rebuildSpy = vi.spyOn(db, "rebuildFts5Index").mockReturnValue(true);

      const insertSpy = vi.spyOn(harness.store() as any, "insertTask");
      const originalInsert = insertSpy.getMockImplementation();
      insertSpy
        .mockImplementationOnce(() => {
          throw new Error("SQLITE_CORRUPT: corruption found reading blob in fts5");
        })
        .mockImplementation((task: any) => {
          if (originalInsert) {
            return originalInsert(task);
          }
          return (Object.getPrototypeOf(harness.store()) as any).insertTask.call(harness.store(), task);
        });

      const created = await harness.store().createTask({ description: "Recover from FTS corruption" });

      expect(created.id).toBeDefined();
      expect(rebuildSpy).toHaveBeenCalledTimes(1);
      expect(insertSpy).toHaveBeenCalledTimes(2);
    });

    it("propagates non-FTS errors without rebuild", async () => {
      const db = harness.store().getDatabase();
      const rebuildSpy = vi.spyOn(db, "rebuildFts5Index").mockReturnValue(true);
      vi.spyOn(harness.store() as any, "insertTask").mockImplementationOnce(() => {
        throw new Error("constraint failed");
      });

      await expect(harness.store().createTask({ description: "Should fail" })).rejects.toThrow("constraint failed");
      expect(rebuildSpy).not.toHaveBeenCalled();
    });
  });
});
