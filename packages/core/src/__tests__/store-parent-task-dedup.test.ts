import { afterEach, beforeEach, describe, expect, it, beforeAll, afterAll } from "vitest";

import { createSharedTaskStoreTestHarness } from "./store-test-helpers.js";

describe("TaskStore parent-task duplicate intake", () => {
  const harness = createSharedTaskStoreTestHarness();

  beforeAll(harness.beforeAll);
  afterAll(harness.afterAll);
  let store = harness.store();

  beforeEach(async () => {
    await harness.beforeEach();
    store = harness.store();
  });

  afterEach(async () => {
    await harness.afterEach();
  });

  it("auto-archives a sibling created by the same parent task with similar description when autoArchiveDuplicateTasksEnabled is true", async () => {
    // FN-7658: default is now flag-in-place; explicitly opt back into the legacy
    // auto-archive behavior to cover it is still reachable.
    await store.updateSettings({ autoArchiveDuplicateTasksEnabled: true });
    const parentId = "FN-PARENT";

    const first = await store.createTask({
      title: "Add structured run-audit event for per-lane provider/runtime selection",
      description:
        "Add structured run-audit event recording per-lane provider/runtime selection (FN-5206 deferral)",
      column: "triage",
      source: {
        sourceType: "agent_heartbeat",
        sourceAgentId: "agent-alpha",
        sourceParentTaskId: parentId,
      },
    });

    const second = await store.createTask({
      title: "Emit run-audit event capturing lane provider/runtime selection",
      description:
        "Emit a structured run-audit event capturing per-lane provider/runtime selection for FN-5206 deferral",
      column: "triage",
      source: {
        // Different agent — but same parent. Should still dedup.
        sourceType: "agent_heartbeat",
        sourceAgentId: "agent-beta",
        sourceParentTaskId: parentId,
      },
    });

    const refreshed = await store.getTask(second.id);
    expect(refreshed.column).toBe("archived");

    const firstRefreshed = await store.getTask(first.id);
    expect(firstRefreshed.column).toBe("triage");
  });

  it("does not archive siblings with different parent tasks", async () => {
    await store.createTask({
      title: "Add structured run-audit event",
      description: "Add structured run-audit event recording per-lane provider/runtime selection",
      column: "triage",
      source: {
        sourceType: "agent_heartbeat",
        sourceAgentId: "agent-alpha",
        sourceParentTaskId: "FN-PARENT-A",
      },
    });

    const second = await store.createTask({
      title: "Add structured run-audit event",
      description: "Add structured run-audit event recording per-lane provider/runtime selection",
      column: "triage",
      source: {
        sourceType: "agent_heartbeat",
        sourceAgentId: "agent-beta",
        sourceParentTaskId: "FN-PARENT-B",
      },
    });

    const refreshed = await store.getTask(second.id);
    expect(refreshed.column).toBe("triage");
  });
});
