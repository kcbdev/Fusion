import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { TaskStore } from "../store.js";

describe("TaskStore stalledReview hydration", () => {
  let rootDir: string;
  let globalDir: string;
  let store: TaskStore;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "store-stalled-review-"));
    globalDir = join(rootDir, ".fusion-global-settings");
    store = new TaskStore(rootDir, globalDir, { inMemoryDb: true });
    await store.init();
  });

  afterEach(async () => {
    await store.close();
    await rm(rootDir, { recursive: true, force: true });
  });

  async function seedStalledInReviewTask() {
    const task = await store.createTask({
      description: "stalled review candidate",
      column: "in-review",
    });

    for (let i = 0; i < 3; i += 1) {
      await store.logEntry(task.id, "Auto-recovered: eligible in-review task re-enqueued for merge");
    }

    return task;
  }

  it("populates stalledReview on slim listings when reenqueue churn threshold is met", async () => {
    const task = await seedStalledInReviewTask();

    const slimTasks = await store.listTasks({ slim: true, column: "in-review" });
    const hydrated = slimTasks.find((entry) => entry.id === task.id);

    expect(hydrated?.stalledReview?.heuristic).toBe("reenqueue-churn");
    expect(hydrated?.stalledReview?.matchCount).toBe(3);
  });

  it("populates stalledReview on full listings and detail fetches", async () => {
    const task = await seedStalledInReviewTask();

    const fullTasks = await store.listTasks({ slim: false, column: "in-review" });
    const hydrated = fullTasks.find((entry) => entry.id === task.id);
    expect(hydrated?.stalledReview?.heuristic).toBe("reenqueue-churn");

    const detail = await store.getTask(task.id);
    expect(detail.stalledReview?.heuristic).toBe("reenqueue-churn");
    expect(detail.stalledReview?.matchCount).toBe(3);
  });
});
