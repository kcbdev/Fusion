import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TaskStore } from "../store.js";
import { createTaskStoreTestHarness } from "./store-test-helpers.js";

describe("TaskStore.applyPrMergedTransition", () => {
  const harness = createTaskStoreTestHarness();
  let store: TaskStore;

  beforeEach(async () => {
    await harness.beforeEach();
    store = harness.store();
  });

  afterEach(async () => {
    await harness.afterEach();
  });

  it("moves in-review merged tasks to done once and emits task:merged", async () => {
    const task = await store.createTask({ description: "merged task" });
    await store.moveTask(task.id, "todo");
    await store.moveTask(task.id, "in-progress");
    await store.moveTask(task.id, "in-review");
    await store.updatePrInfo(task.id, {
      url: "https://github.com/o/r/pull/1",
      number: 1,
      status: "merged",
      title: "pr",
      headBranch: "fusion/fn-1",
      baseBranch: "main",
      commentCount: 0,
    });
    const mergedListener = vi.fn();
    store.on("task:merged", mergedListener);

    await expect(store.applyPrMergedTransition(task.id)).resolves.toEqual({ moved: true });
    expect(mergedListener).toHaveBeenCalledTimes(1);
    expect(mergedListener).toHaveBeenCalledWith(expect.objectContaining({
      branch: "fusion/fn-1",
      merged: true,
      task: expect.objectContaining({ id: task.id, column: "done" }),
    }));

    await expect(store.applyPrMergedTransition(task.id)).resolves.toEqual({ moved: false, skipped: "already-done" });
    expect(mergedListener).toHaveBeenCalledTimes(1);
  });

  it("skips when pr status is not merged", async () => {
    const task = await store.createTask({ description: "open pr task" });
    await store.moveTask(task.id, "todo");
    await store.moveTask(task.id, "in-progress");
    await store.moveTask(task.id, "in-review");
    await store.updatePrInfo(task.id, {
      url: "https://github.com/o/r/pull/2",
      number: 2,
      status: "open",
      title: "pr",
      headBranch: "fusion/fn-2",
      baseBranch: "main",
      commentCount: 0,
    });

    await expect(store.applyPrMergedTransition(task.id)).resolves.toEqual({ moved: false, skipped: "not-merged" });
  });

  it("skips non in-review columns", async () => {
    const task = await store.createTask({ description: "todo pr task" });
    await store.moveTask(task.id, "todo");
    await store.updatePrInfo(task.id, {
      url: "https://github.com/o/r/pull/3",
      number: 3,
      status: "merged",
      title: "pr",
      headBranch: "fusion/fn-3",
      baseBranch: "main",
      commentCount: 0,
    });

    await expect(store.applyPrMergedTransition(task.id)).resolves.toEqual({ moved: false, skipped: "wrong-column" });
  });

  it("skips paused tasks", async () => {
    const task = await store.createTask({ description: "paused merged pr" });
    await store.moveTask(task.id, "todo");
    await store.moveTask(task.id, "in-progress");
    await store.moveTask(task.id, "in-review");
    await store.updateTask(task.id, { paused: true });
    await store.updatePrInfo(task.id, {
      url: "https://github.com/o/r/pull/4",
      number: 4,
      status: "merged",
      title: "pr",
      headBranch: "fusion/fn-4",
      baseBranch: "main",
      commentCount: 0,
    });

    await expect(store.applyPrMergedTransition(task.id)).resolves.toEqual({ moved: false, skipped: "paused" });
  });

  it("skipMergeBlocker bypasses in-review blocker when explicitly requested", async () => {
    const task = await store.createTask({ description: "blocked done move" });
    await store.moveTask(task.id, "todo");
    await store.moveTask(task.id, "in-progress");
    await store.moveTask(task.id, "in-review");
    await store.updateTask(task.id, { status: "failed" });

    await expect(store.moveTask(task.id, "done")).rejects.toThrow(/Cannot move/);
    await expect(store.moveTask(task.id, "done", { skipMergeBlocker: true })).resolves.toMatchObject({
      id: task.id,
      column: "done",
    });
  });
});
