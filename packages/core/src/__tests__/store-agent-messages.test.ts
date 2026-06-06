import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { createTaskStoreTestHarness } from "./store-test-helpers.js";

// U9: per-task, per-agent queued messaging built on the steering-comment channel.
// These cover the store-level lifecycle (queue/list/cancel/discard/persistence);
// the executor injection/dispatch semantics live in the engine test file.
describe("TaskStore — per-agent queued messages (U9)", () => {
  const harness = createTaskStoreTestHarness();
  let store: ReturnType<typeof harness.store>;

  beforeEach(async () => {
    await harness.beforeEach();
    store = harness.store();
  });

  afterEach(async () => {
    await harness.afterEach();
  });

  const createTestTask = () => harness.createTestTask();

  it("queues a message addressed to an agent as pending and lists it", async () => {
    const task = await createTestTask();
    const { messageId } = await store.queueAgentMessage(task.id, "agent-lead", "Please reconsider scope", "user");

    const pending = await store.listAgentMessages(task.id, { state: "pending" });
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe(messageId);
    expect(pending[0].targetAgentId).toBe("agent-lead");
    expect(pending[0].deliveryState).toBe("pending");
    expect(pending[0].text).toBe("Please reconsider scope");

    // Also written to the unified comment thread for display.
    const full = await store.getTask(task.id);
    expect(full.comments?.some((c) => c.id === messageId)).toBe(true);
  });

  it("listAgentMessages excludes untargeted steering comments", async () => {
    const task = await createTestTask();
    await store.addSteeringComment(task.id, "broadcast steering", "user");
    await store.queueAgentMessage(task.id, "agent-exec", "addressed", "user");

    const all = await store.listAgentMessages(task.id);
    expect(all).toHaveLength(1);
    expect(all[0].targetAgentId).toBe("agent-exec");
  });

  it("filters by targetAgentId", async () => {
    const task = await createTestTask();
    await store.queueAgentMessage(task.id, "agent-a", "to A", "user");
    await store.queueAgentMessage(task.id, "agent-b", "to B", "user");

    const forA = await store.listAgentMessages(task.id, { targetAgentId: "agent-a" });
    expect(forA).toHaveLength(1);
    expect(forA[0].text).toBe("to A");
  });

  it("cancel flips pending → cancelled and logs a note", async () => {
    const task = await createTestTask();
    const { messageId } = await store.queueAgentMessage(task.id, "agent-lead", "never mind", "user");

    const updated = await store.cancelQueuedMessage(task.id, messageId);

    const cancelled = await store.listAgentMessages(task.id, { state: "cancelled" });
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0].id).toBe(messageId);
    expect(await store.listAgentMessages(task.id, { state: "pending" })).toHaveLength(0);
    expect(updated.log.some((e) => e.action.includes("cancelled before delivery"))).toBe(true);
  });

  it("cancel is a no-op once a message is already delivered", async () => {
    const task = await createTestTask();
    const { messageId } = await store.queueAgentMessage(task.id, "agent-lead", "hi", "user");
    await store.markAgentMessagesDelivered(task.id, "agent-lead");

    await store.cancelQueuedMessage(task.id, messageId);
    const delivered = await store.listAgentMessages(task.id, { state: "delivered" });
    expect(delivered).toHaveLength(1);
    expect(await store.listAgentMessages(task.id, { state: "cancelled" })).toHaveLength(0);
  });

  it("markAgentMessagesDelivered only affects the target agent's pending messages", async () => {
    const task = await createTestTask();
    await store.queueAgentMessage(task.id, "agent-a", "to A", "user");
    await store.queueAgentMessage(task.id, "agent-b", "to B", "user");

    const delivered = await store.markAgentMessagesDelivered(task.id, "agent-a");
    expect(delivered).toHaveLength(1);

    expect(await store.listAgentMessages(task.id, { state: "delivered" })).toHaveLength(1);
    expect(await store.listAgentMessages(task.id, { state: "pending", targetAgentId: "agent-b" })).toHaveLength(1);
  });

  it("archiving a task with pending messages discards them with a task-log note", async () => {
    const task = await createTestTask();
    await store.queueAgentMessage(task.id, "agent-lead", "pending one", "user");
    await store.queueAgentMessage(task.id, "agent-exec", "pending two", "user");

    // Archive requires the task to be in 'done'.
    await store.moveTask(task.id, "todo");
    await store.moveTask(task.id, "in-progress");
    await store.moveTask(task.id, "done");
    const archived = await store.archiveTask(task.id, { cleanup: false });

    const discarded = await store.listAgentMessages(task.id, { state: "discarded" });
    expect(discarded).toHaveLength(2);
    expect(await store.listAgentMessages(task.id, { state: "pending" })).toHaveLength(0);
    expect(
      archived.log.some((e) => e.action.includes("Discarded") && e.action.includes("queued message")),
    ).toBe(true);
  });

  it("archiving does NOT touch already-delivered messages", async () => {
    const task = await createTestTask();
    await store.queueAgentMessage(task.id, "agent-lead", "delivered", "user");
    await store.markAgentMessagesDelivered(task.id, "agent-lead");

    await store.moveTask(task.id, "todo");
    await store.moveTask(task.id, "in-progress");
    await store.moveTask(task.id, "done");
    const archived = await store.archiveTask(task.id, { cleanup: false });

    expect(await store.listAgentMessages(task.id, { state: "delivered" })).toHaveLength(1);
    expect(await store.listAgentMessages(task.id, { state: "discarded" })).toHaveLength(0);
    expect(archived.log.some((e) => e.action.includes("Discarded"))).toBe(false);
  });

  it("pending messages survive a store reopen", async () => {
    const task = await createTestTask();
    await store.queueAgentMessage(task.id, "agent-lead", "still here", "user");

    await harness.reopenDiskBackedStore();
    store = harness.store();

    const pending = await store.listAgentMessages(task.id, { state: "pending" });
    expect(pending).toHaveLength(1);
    expect(pending[0].text).toBe("still here");
    expect(pending[0].targetAgentId).toBe("agent-lead");
  });
});
