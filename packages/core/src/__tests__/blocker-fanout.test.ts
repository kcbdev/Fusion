import { describe, expect, it } from "vitest";
import type { Task } from "../types.js";
import { computeBlockerFanoutMap } from "../blocker-fanout.js";

const MAX_AUTO_MERGE_RETRIES = 3;

function createTask(id: string, column: Task["column"], overrides: Partial<Task> = {}): Task {
  return {
    id,
    description: id,
    column,
    dependencies: [],
    steps: [],
    currentStep: 0,
    log: [],
    createdAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
    updatedAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
    ...overrides,
  };
}

describe("computeBlockerFanoutMap escalation", () => {
  it("escalates high fan-out blockers when age crosses threshold", () => {
    const nowMs = Date.parse("2026-01-01T06:00:00.000Z");
    const blocker = createTask("B", "in-progress", { columnMovedAt: "2026-01-01T00:00:00.000Z" });
    const dependents = [1, 2, 3, 4, 5].map((n) => createTask(`D${n}`, "todo", { dependencies: ["B"] }));

    const entry = computeBlockerFanoutMap([blocker, ...dependents], MAX_AUTO_MERGE_RETRIES, {
      nowMs,
      staleHighFanoutAgeThresholdMs: 60 * 60 * 1000,
    }).get("B");

    expect(entry?.escalation).toEqual({
      blockerId: "B",
      activeTodoCount: 5,
      totalActiveCount: 5,
      blockingAgeMs: 6 * 60 * 60 * 1000,
    });
  });

  it("keeps short-lived high fan-out blockers quiet", () => {
    const nowMs = Date.parse("2026-01-01T00:10:00.000Z");
    const blocker = createTask("B", "in-progress", { columnMovedAt: "2026-01-01T00:00:00.000Z" });
    const dependents = [1, 2, 3, 4, 5].map((n) => createTask(`D${n}`, "todo", { dependencies: ["B"] }));

    const entry = computeBlockerFanoutMap([blocker, ...dependents], MAX_AUTO_MERGE_RETRIES, {
      nowMs,
      staleHighFanoutAgeThresholdMs: 60 * 60 * 1000,
    }).get("B");

    expect(entry?.isHighFanout).toBe(true);
    expect(entry?.escalation).toBeUndefined();
  });

  it("does not escalate sub-threshold chains", () => {
    const nowMs = Date.parse("2026-01-01T10:00:00.000Z");
    const blocker = createTask("B", "in-review", { columnMovedAt: "2026-01-01T00:00:00.000Z" });
    const dependents = [1, 2, 3, 4].map((n) => createTask(`D${n}`, "todo", { dependencies: ["B"] }));

    const entry = computeBlockerFanoutMap([blocker, ...dependents], MAX_AUTO_MERGE_RETRIES, {
      nowMs,
      staleHighFanoutAgeThresholdMs: 60 * 60 * 1000,
    }).get("B");

    expect(entry?.isHighFanout).toBe(false);
    expect(entry?.escalation).toBeUndefined();
  });
});
