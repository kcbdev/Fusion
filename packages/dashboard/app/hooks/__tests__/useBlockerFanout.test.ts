import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Task } from "@fusion/core";
import { computeBlockerFanoutMap, MAX_AUTO_MERGE_RETRIES } from "../useBlockerFanout";

function createTask(id: string, column: Task["column"], overrides: Partial<Task> = {}): Task {
  return {
    id,
    description: `Task ${id}`,
    column,
    dependencies: [],
    steps: [],
    currentStep: 0,
    log: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("computeBlockerFanoutMap", () => {
  it("returns an empty map for an empty task list", () => {
    expect(computeBlockerFanoutMap([]).size).toBe(0);
  });

  it("returns an empty map when no downstream dependencies exist", () => {
    const tasks = [createTask("FN-1", "todo"), createTask("FN-2", "done")];
    expect(computeBlockerFanoutMap(tasks).size).toBe(0);
  });

  it("tracks a single dependent via dependencies[]", () => {
    const tasks = [
      createTask("FN-1", "in-progress"),
      createTask("FN-2", "todo", { dependencies: ["FN-1"] }),
    ];

    expect(computeBlockerFanoutMap(tasks).get("FN-1")).toEqual({
      totalCount: 1,
      activeTodoCount: 1,
      dependentIds: ["FN-2"],
      staleBlockedByDependentIds: [],
      isHighFanout: false,
      escalation: undefined,
    });
  });

  it("tracks mixed dependencies[] and blockedBy edges", () => {
    const tasks = [
      createTask("FN-1", "in-progress"),
      createTask("FN-2", "todo", { dependencies: ["FN-1"] }),
      createTask("FN-3", "in-review", { blockedBy: "FN-1" }),
    ];

    expect(computeBlockerFanoutMap(tasks).get("FN-1")).toEqual({
      totalCount: 2,
      activeTodoCount: 1,
      dependentIds: ["FN-2", "FN-3"],
      staleBlockedByDependentIds: [],
      isHighFanout: false,
      escalation: undefined,
    });
  });

  it("excludes done/archived dependents from totalCount but keeps dependentIds", () => {
    const tasks = [
      createTask("FN-1", "in-progress"),
      createTask("FN-2", "done", { dependencies: ["FN-1"] }),
      createTask("FN-3", "archived", { blockedBy: "FN-1" }),
      createTask("FN-4", "todo", { dependencies: ["FN-1"] }),
    ];

    expect(computeBlockerFanoutMap(tasks).get("FN-1")).toEqual({
      totalCount: 1,
      activeTodoCount: 1,
      dependentIds: ["FN-2", "FN-3", "FN-4"],
      staleBlockedByDependentIds: [],
      isHighFanout: false,
      escalation: undefined,
    });
  });

  it("marks stale blockedBy dependents only for blockedBy edges, not dependencies[]", () => {
    const tasks = [
      createTask("FN-2", "todo", { dependencies: ["MISSING"] }),
      createTask("FN-3", "todo", { blockedBy: "MISSING" }),
    ];

    expect(computeBlockerFanoutMap(tasks).get("MISSING")).toEqual({
      totalCount: 2,
      activeTodoCount: 2,
      dependentIds: ["FN-2", "FN-3"],
      staleBlockedByDependentIds: ["FN-3"],
      isHighFanout: false,
      escalation: undefined,
    });
  });

  it("marks blockedBy edges stale when blocker is done", () => {
    const tasks = [createTask("B", "done"), createTask("D", "todo", { blockedBy: "B" })];
    expect(computeBlockerFanoutMap(tasks).get("B")?.staleBlockedByDependentIds).toEqual(["D"]);
  });

  it("marks blockedBy edges stale when blocker is archived", () => {
    const tasks = [createTask("B", "archived"), createTask("D", "todo", { blockedBy: "B" })];
    expect(computeBlockerFanoutMap(tasks).get("B")?.staleBlockedByDependentIds).toEqual(["D"]);
  });

  it("marks blockedBy edges stale when blocker is in-review and paused", () => {
    const tasks = [createTask("B", "in-review", { paused: true }), createTask("D", "todo", { blockedBy: "B" })];
    expect(computeBlockerFanoutMap(tasks).get("B")?.staleBlockedByDependentIds).toEqual(["D"]);
  });

  it("marks blockedBy edges stale when blocker failed in-review at max retries", () => {
    const tasks = [
      createTask("B", "in-review", { status: "failed", mergeRetries: MAX_AUTO_MERGE_RETRIES }),
      createTask("D", "todo", { blockedBy: "B" }),
    ];
    expect(computeBlockerFanoutMap(tasks).get("B")?.staleBlockedByDependentIds).toEqual(["D"]);
  });

  it("FN-3897 regression: reports active and todo downstream counts for high fan-out blockers", () => {
    const tasks = [
      createTask("B", "in-progress"),
      createTask("D1", "todo", { dependencies: ["B"] }),
      createTask("D2", "todo", { blockedBy: "B" }),
      createTask("D3", "in-review", { dependencies: ["B"] }),
      createTask("D4", "done", { dependencies: ["B"] }),
    ];

    expect(computeBlockerFanoutMap(tasks).get("B")).toEqual({
      totalCount: 3,
      activeTodoCount: 2,
      dependentIds: ["D1", "D2", "D3", "D4"],
      staleBlockedByDependentIds: [],
      isHighFanout: false,
      escalation: undefined,
    });
  });

  it("flags blockers with at least 5 active todo dependents as high fan-out", () => {
    const tasks = [
      createTask("B", "in-progress"),
      createTask("D1", "todo", { dependencies: ["B"] }),
      createTask("D2", "todo", { dependencies: ["B"] }),
      createTask("D3", "todo", { blockedBy: "B" }),
      createTask("D4", "todo", { blockedBy: "B" }),
      createTask("D5", "todo", { dependencies: ["B"] }),
      createTask("DONE", "done", { dependencies: ["B"] }),
    ];

    expect(computeBlockerFanoutMap(tasks).get("B")).toEqual({
      totalCount: 5,
      activeTodoCount: 5,
      dependentIds: ["D1", "D2", "D3", "D4", "D5", "DONE"],
      staleBlockedByDependentIds: [],
      isHighFanout: true,
      escalation: undefined,
    });
  });

  it("does not flag ordinary fan-out chains below threshold", () => {
    const tasks = [
      createTask("B", "in-review"),
      createTask("D1", "todo", { dependencies: ["B"] }),
      createTask("D2", "todo", { blockedBy: "B" }),
      createTask("D3", "todo", { dependencies: ["B"] }),
      createTask("D4", "todo", { dependencies: ["B"] }),
      createTask("ARCH", "archived", { dependencies: ["B"] }),
    ];

    expect(computeBlockerFanoutMap(tasks).get("B")).toEqual({
      totalCount: 4,
      activeTodoCount: 4,
      dependentIds: ["D1", "D2", "D3", "D4", "ARCH"],
      staleBlockedByDependentIds: [],
      isHighFanout: false,
      escalation: undefined,
    });
  });

  it("escalates aged high fan-out blockers only when old enough", () => {
    const tasks = [
      createTask("B", "in-progress", { columnMovedAt: "2026-01-01T00:00:00.000Z" }),
      createTask("D1", "todo", { dependencies: ["B"] }),
      createTask("D2", "todo", { dependencies: ["B"] }),
      createTask("D3", "todo", { dependencies: ["B"] }),
      createTask("D4", "todo", { dependencies: ["B"] }),
      createTask("D5", "todo", { dependencies: ["B"] }),
    ];

    const entry = computeBlockerFanoutMap(tasks, {
      staleHighFanoutAgeThresholdMs: 60 * 60 * 1000,
    }).get("B");

    expect(entry?.isHighFanout).toBe(true);
    expect(entry?.escalation?.blockerId).toBe("B");
    expect(entry?.escalation?.activeTodoCount).toBe(5);
    expect((entry?.escalation?.blockingAgeMs ?? 0) / (60 * 60 * 1000)).toBeGreaterThanOrEqual(1);
  });

  it("keeps short-lived high fan-out blockers quiet", () => {
    const tasks = [
      createTask("B", "in-progress", { columnMovedAt: new Date().toISOString() }),
      createTask("D1", "todo", { dependencies: ["B"] }),
      createTask("D2", "todo", { dependencies: ["B"] }),
      createTask("D3", "todo", { dependencies: ["B"] }),
      createTask("D4", "todo", { dependencies: ["B"] }),
      createTask("D5", "todo", { dependencies: ["B"] }),
    ];

    const entry = computeBlockerFanoutMap(tasks, {
      staleHighFanoutAgeThresholdMs: 60 * 60 * 1000,
    }).get("B");

    expect(entry?.isHighFanout).toBe(true);
    expect(entry?.escalation).toBeUndefined();
  });

  it("keeps MAX_AUTO_MERGE_RETRIES aligned with engine self-healing source", () => {
    const testDir = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(resolve(testDir, "../../../../engine/src/self-healing.ts"), "utf8");
    const match = source.match(/const MAX_AUTO_MERGE_RETRIES = (\d+);/);
    expect(match?.[1]).toBe(String(MAX_AUTO_MERGE_RETRIES));
  });
});
