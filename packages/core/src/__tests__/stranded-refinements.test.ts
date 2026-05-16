import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TaskStore } from "../store.js";

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "kb-stranded-refinements-"));
}

describe("TaskStore.listStrandedRefinements", () => {
  let rootDir: string;
  let store: TaskStore;

  beforeEach(async () => {
    rootDir = makeTmpDir();
    store = new TaskStore(rootDir, join(rootDir, ".fusion-global-settings"), { inMemoryDb: true });
    await store.init();
  });

  afterEach(async () => {
    store.stopWatching();
    await rm(rootDir, { recursive: true, force: true });
  });

  it("classifies stranded refinement reasons and excludes fresh/paused/non-triage", async () => {
    const createRefinement = async (label: string) => {
      const source = await store.createTask({ description: `source-${label}`, column: "done" });
      return store.refineTask(source.id, `refine-${label}`);
    };

    const stale = await createRefinement("stale");
    const awaiting = await createRefinement("awaiting");
    const failed = await createRefinement("failed");
    const stuck = await createRefinement("stuck");
    const backoff = await createRefinement("backoff");
    const paused = await createRefinement("paused");
    const fresh = await createRefinement("fresh");
    const nonTriage = await createRefinement("todo");

    await store.updateTask(awaiting.id, { status: "awaiting-approval" });
    await store.updateTask(failed.id, { status: "failed" });
    await store.updateTask(stuck.id, { status: "stuck-killed" });
    await store.updateTask(backoff.id, { nextRecoveryAt: new Date(Date.now() + 60_000).toISOString() });
    await store.updateTask(paused.id, { paused: true });
    await store.moveTask(nonTriage.id, "todo");

    const db = store.getDatabase();
    db.prepare('UPDATE tasks SET createdAt = ?, updatedAt = ? WHERE id = ?').run(
      new Date(Date.now() - 11 * 60_000).toISOString(),
      new Date().toISOString(),
      stale.id,
    );

    const list = await store.listStrandedRefinements({ freshnessThresholdMs: 10 * 60 * 1000 });
    const byId = new Map(list.map((entry) => [entry.task.id, entry.reasons]));

    expect(byId.get(stale.id)).toContain("untriaged-stale");
    expect(byId.get(awaiting.id)).toContain("awaiting-approval");
    expect(byId.get(failed.id)).toContain("failed");
    expect(byId.get(stuck.id)).toContain("stuck-killed");
    expect(byId.get(backoff.id)).toContain("recovery-backoff");
    expect(byId.has(paused.id)).toBe(false);
    expect(byId.has(fresh.id)).toBe(false);
    expect(byId.has(nonTriage.id)).toBe(false);
  });

  it("returns empty when no refinement tasks are stranded", async () => {
    await store.createTask({ description: "normal task" });
    const list = await store.listStrandedRefinements();
    expect(list).toEqual([]);
  });
});
