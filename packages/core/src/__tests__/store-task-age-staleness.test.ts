import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TaskStore } from "../store.js";

describe("TaskStore ageStaleness hydration", () => {
  let rootDir: string;
  let globalDir: string;
  let store: TaskStore;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "store-task-age-staleness-"));
    globalDir = join(rootDir, ".fusion-global-settings");
    store = new TaskStore(rootDir, globalDir, { inMemoryDb: true });
    await store.init();
  });

  afterEach(async () => {
    await store.close();
    await rm(rootDir, { recursive: true, force: true });
  });

  async function seedTask(
    id: string,
    overrides: { column: "in-progress" | "in-review" | "todo"; paused?: boolean; ageMs: number; mergeConfirmed?: boolean },
  ) {
    const now = Date.now();
    const movedAt = new Date(now - overrides.ageMs).toISOString();
    await store.createTaskWithReservedId(
      { description: id, column: overrides.column },
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

  it("hydrates warning for stale in-progress", async () => {
    await seedTask("FN-STALE-WARN", { column: "in-progress", ageMs: 4 * 60 * 60_000 + 1_000 });
    const task = (await store.listTasks({ slim: true })).find((entry) => entry.id === "FN-STALE-WARN");
    expect(task?.ageStaleness?.level).toBe("warning");
  });

  it("hydrates critical when over critical threshold", async () => {
    await seedTask("FN-STALE-CRIT", { column: "in-progress", ageMs: 24 * 60 * 60_000 + 1_000 });
    const task = (await store.listTasks({ slim: true })).find((entry) => entry.id === "FN-STALE-CRIT");
    expect(task?.ageStaleness?.level).toBe("critical");
  });

  it("hydrates for paused in-review tasks", async () => {
    await seedTask("FN-STALE-PAUSED", { column: "in-review", paused: true, ageMs: 24 * 60 * 60_000 + 1_000 });
    const task = (await store.listTasks({ slim: true })).find((entry) => entry.id === "FN-STALE-PAUSED");
    expect(task?.ageStaleness?.level).toBe("warning");
    expect(task?.ageStaleness?.paused).toBe(true);
  });

  it("omits signal for todo", async () => {
    await seedTask("FN-STALE-TODO", { column: "todo", ageMs: 7 * 24 * 60 * 60_000 });
    const task = (await store.listTasks({ slim: true })).find((entry) => entry.id === "FN-STALE-TODO");
    expect(task?.ageStaleness).toBeUndefined();
  });

  it("respects settings overrides", async () => {
    await store.updateSettings({ staleInProgressWarningMs: 1_000, staleInProgressCriticalMs: 2_000 });
    await seedTask("FN-STALE-OVERRIDE", { column: "in-progress", ageMs: 2_500 });
    const task = (await store.listTasks({ slim: true })).find((entry) => entry.id === "FN-STALE-OVERRIDE");
    expect(task?.ageStaleness?.level).toBe("critical");
  });

  it("omits signal when both levels are disabled", async () => {
    await store.updateSettings({ staleInProgressWarningMs: 0, staleInProgressCriticalMs: 0 });
    await seedTask("FN-STALE-DISABLED", { column: "in-progress", ageMs: 48 * 60 * 60_000 });
    const task = (await store.listTasks({ slim: true })).find((entry) => entry.id === "FN-STALE-DISABLED");
    expect(task?.ageStaleness).toBeUndefined();
  });
});
