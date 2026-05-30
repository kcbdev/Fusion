import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { createTaskStoreTestHarness } from "./store-test-helpers.js";
import type { TaskStore } from "../store.js";

describe("TaskStore dependency mutations", () => {
  const harness = createTaskStoreTestHarness();
  let store: TaskStore;

  beforeEach(async () => {
    await harness.beforeEach();
    store = harness.store();
  });

  afterEach(harness.afterEach);

  it("replaces an obsolete dependency and clears stale blockers when the replacement is done", async () => {
    const obsolete = await store.createTask({ description: "obsolete prerequisite" });
    const canonical = await store.createTask({ description: "canonical prerequisite", column: "done" });
    const dependent = await store.createTask({
      description: "dependent task",
      column: "todo",
      dependencies: [obsolete.id],
    });
    await store.updateTask(dependent.id, { status: "queued", blockedBy: obsolete.id });

    const updated = await store.updateTaskDependencies(dependent.id, {
      operation: "replace",
      from: obsolete.id,
      to: canonical.id,
    });

    expect(updated.dependencies).toEqual([canonical.id]);
    expect(updated.blockedBy).toBeUndefined();
    expect(updated.status).toBeUndefined();
    expect(updated.column).toBe("triage");
    expect(updated.log.at(-2)?.action).toBe("Moved to triage for re-specification — new dependency added");
    expect(updated.log.at(-1)?.action).toContain(`Replaced dependency ${obsolete.id} with ${canonical.id}`);

    const reloaded = await store.getTask(dependent.id);
    expect(reloaded.dependencies).toEqual([canonical.id]);
    expect(reloaded.blockedBy).toBeUndefined();

    const taskJson = JSON.parse(
      await readFile(join(harness.rootDir(), ".fusion", "tasks", dependent.id, "task.json"), "utf-8"),
    ) as { dependencies: string[]; blockedBy?: string; column: string; status?: string };
    expect(taskJson.dependencies).toEqual([canonical.id]);
    expect(taskJson.blockedBy).toBeUndefined();
    expect(taskJson.column).toBe("triage");
    expect(taskJson.status).toBeUndefined();
  });

  it("repoints stale blockedBy when the current blocker is resolved but still a dependency", async () => {
    const resolved = await store.createTask({ description: "resolved prerequisite", column: "done" });
    const unresolved = await store.createTask({ description: "unresolved prerequisite" });
    const dependent = await store.createTask({
      description: "dependent task",
      column: "todo",
      dependencies: [resolved.id],
    });
    await store.updateTask(dependent.id, { blockedBy: resolved.id });

    const updated = await store.updateTaskDependencies(dependent.id, {
      operation: "add",
      dependency: unresolved.id,
    });

    expect(updated.dependencies).toEqual([resolved.id, unresolved.id]);
    expect(updated.blockedBy).toBe(unresolved.id);
    expect(updated.column).toBe("triage");

    const taskJson = JSON.parse(
      await readFile(join(harness.rootDir(), ".fusion", "tasks", dependent.id, "task.json"), "utf-8"),
    ) as { dependencies: string[]; blockedBy?: string; column: string };
    expect(taskJson.dependencies).toEqual([resolved.id, unresolved.id]);
    expect(taskJson.blockedBy).toBe(unresolved.id);
    expect(taskJson.column).toBe("triage");
  });

  it("rejects missing replacements, duplicates, self dependencies, and cycles", async () => {
    const a = await store.createTask({ description: "a" });
    const b = await store.createTask({ description: "b", dependencies: [a.id] });
    const c = await store.createTask({ description: "c", dependencies: [a.id] });

    await expect(
      store.updateTaskDependencies(c.id, { operation: "replace", from: b.id, to: a.id }),
    ).rejects.toThrow(/does not depend on/);

    await expect(
      store.updateTaskDependencies(c.id, { operation: "add", dependency: a.id }),
    ).rejects.toThrow(/already depends on/);

    await expect(
      store.updateTaskDependencies(c.id, { operation: "add", dependency: c.id }),
    ).rejects.toThrow(/cannot depend on itself/);

    await expect(
      store.updateTaskDependencies(a.id, { operation: "add", dependency: c.id }),
    ).rejects.toThrow(/Dependency cycle detected/);
  });
});
