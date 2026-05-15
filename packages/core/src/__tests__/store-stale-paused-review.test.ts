import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TaskStore } from "../store.js";

describe("TaskStore stalePausedReview hydration", () => {
  let rootDir: string;
  let globalDir: string;
  let store: TaskStore;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "store-stale-paused-review-"));
    globalDir = join(rootDir, ".fusion-global-settings");
    store = new TaskStore(rootDir, globalDir, { inMemoryDb: true });
    await store.init();
  });

  afterEach(async () => {
    await store.close();
    await rm(rootDir, { recursive: true, force: true });
  });

  async function seedTask(id: string, overrides: { paused?: boolean; ageMs?: number; column?: "in-review" | "todo"; mergeConfirmed?: boolean }) {
    const now = Date.now();
    const ageMs = overrides.ageMs ?? 24 * 60 * 60_000 + 1_000;
    const movedAt = new Date(now - ageMs).toISOString();
    const column = overrides.column ?? "in-review";
    await store.createTaskWithReservedId(
      { description: id, column },
      { taskId: id, createdAt: movedAt, updatedAt: movedAt, applyDefaultWorkflowSteps: false },
    );
    const db = (store as unknown as { db: { prepare: (sql: string) => { run: (...params: unknown[]) => unknown } } }).db;
    db.prepare(`UPDATE tasks
      SET paused = ?, mergeDetails = ?, columnMovedAt = ?, updatedAt = ?
      WHERE id = ?`).run(
      overrides.paused ? 1 : 0,
      JSON.stringify(overrides.mergeConfirmed ? { mergeConfirmed: true } : {}),
      movedAt,
      movedAt,
      id,
    );
  }

  it("hydrates stalePausedReview for paused in-review past threshold", async () => {
    await seedTask("FN-4452-A", { paused: true });
    const task = (await store.listTasks({ slim: true })).find((entry) => entry.id === "FN-4452-A");
    expect(task?.stalePausedReview?.code).toBe("stale-paused-review");
  });

  it("omits stalePausedReview under threshold", async () => {
    await seedTask("FN-4452-B", { paused: true, ageMs: 1_000 });
    const task = (await store.listTasks({ slim: true })).find((entry) => entry.id === "FN-4452-B");
    expect(task?.stalePausedReview).toBeUndefined();
  });

  it("omits stalePausedReview for non-paused tasks", async () => {
    await seedTask("FN-4452-C", { paused: false });
    const task = (await store.listTasks({ slim: true })).find((entry) => entry.id === "FN-4452-C");
    expect(task?.stalePausedReview).toBeUndefined();
  });

  it("respects stalePausedReviewThresholdMs setting override", async () => {
    await store.updateSettings({ stalePausedReviewThresholdMs: 2_000 });
    await seedTask("FN-4452-D", { paused: true, ageMs: 2_500 });
    const task = (await store.listTasks({ slim: true })).find((entry) => entry.id === "FN-4452-D");
    expect(task?.stalePausedReview?.thresholdMs).toBe(2_000);
  });
});
