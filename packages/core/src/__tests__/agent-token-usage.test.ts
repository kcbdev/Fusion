import { afterEach, beforeEach, describe, expect, it, beforeAll, afterAll } from "vitest";
import { AgentStore } from "../agent-store.js";
import { aggregateAgentTokenUsage, aggregateTaskTokenTotalsByAgentLink } from "../agent-token-usage.js";
import { createSharedTaskStoreTestHarness } from "./store-test-helpers.js";

describe("aggregateAgentTokenUsage", () => {
  const harness = createSharedTaskStoreTestHarness();

  beforeAll(harness.beforeAll);
  afterAll(harness.afterAll);
  let agentStore: AgentStore;

  beforeEach(async () => {
    await harness.beforeEach();
    agentStore = new AgentStore({ rootDir: harness.rootDir() });
    await agentStore.init();
  });

  afterEach(async () => {
    await harness.afterEach();
  });

  it("returns null when agent does not exist", async () => {
    const result = await aggregateAgentTokenUsage({ taskStore: harness.store(), agentStore, agentId: "missing" });
    expect(result).toBeNull();
  });

  it("returns zero windows for an ephemeral task-worker with no token-bearing tasks", async () => {
    const ephemeral = await agentStore.createAgent({ name: "executor-FN-0000", role: "executor", metadata: { agentKind: "task-worker" } });
    await harness.store().createTask({
      description: "task without token usage",
      assignedAgentId: ephemeral.id,
    });

    const result = await aggregateAgentTokenUsage({
      taskStore: harness.store(),
      agentStore,
      agentId: ephemeral.id,
      now: new Date("2026-05-13T12:00:00.000Z"),
    });

    expect(result).not.toBeNull();
    expect(result?.allTime).toMatchObject({ totalInputTokens: 0, totalCachedTokens: 0, totalCacheWriteTokens: 0, totalOutputTokens: 0, nTasks: 0 });
    expect(result?.last24h).toMatchObject({ totalInputTokens: 0, totalCachedTokens: 0, totalCacheWriteTokens: 0, totalOutputTokens: 0, nTasks: 0 });
  });

  it("aggregates task-derived usage for ephemeral task-worker agents", async () => {
    const ephemeral = await agentStore.createAgent({ name: "executor-FN-1234", role: "executor", metadata: { agentKind: "task-worker" } });
    await harness.store().createTask({
      description: "ephemeral worker task",
      assignedAgentId: ephemeral.id,
      tokenUsage: {
        inputTokens: 75,
        outputTokens: 25,
        cachedTokens: 10,
        cacheWriteTokens: 5,
        totalTokens: 115,
        firstUsedAt: "2026-05-13T09:00:00.000Z",
        lastUsedAt: "2026-05-13T11:00:00.000Z",
      },
    });

    const result = await aggregateAgentTokenUsage({
      taskStore: harness.store(),
      agentStore,
      agentId: ephemeral.id,
      now: new Date("2026-05-13T12:00:00.000Z"),
    });

    expect(result).not.toBeNull();
    expect(result?.allTime).toMatchObject({ totalInputTokens: 75, totalCachedTokens: 10, totalCacheWriteTokens: 5, totalOutputTokens: 25, nTasks: 1 });
    expect(result?.last24h).toMatchObject({ totalInputTokens: 75, totalCachedTokens: 10, totalCacheWriteTokens: 5, totalOutputTokens: 25, nTasks: 1 });
  });

  it("aggregates task-derived totals by assigned, source, and checkout agent links without double-counting same-agent links", async () => {
    const agent = await agentStore.createAgent({ name: "executor-FN-links", role: "executor", metadata: { agentKind: "task-worker" } });
    await harness.store().createTask({
      description: "source-linked token usage",
      source: { sourceType: "agent_heartbeat", sourceAgentId: agent.id },
      tokenUsage: {
        inputTokens: 30,
        outputTokens: 7,
        cachedTokens: 3,
        cacheWriteTokens: 1,
        totalTokens: 41,
        firstUsedAt: "2026-05-13T09:00:00.000Z",
        lastUsedAt: "2026-05-13T11:00:00.000Z",
      },
    });
    const checkedTask = await harness.store().createTask({
      description: "checkout-linked token usage",
      tokenUsage: {
        inputTokens: 20,
        outputTokens: 5,
        cachedTokens: 2,
        cacheWriteTokens: 0,
        totalTokens: 27,
        firstUsedAt: "2026-05-13T09:00:00.000Z",
        lastUsedAt: "2026-05-13T11:00:00.000Z",
      },
    });
    await harness.store().updateTask(checkedTask.id, { checkedOutBy: agent.id });
    await harness.store().createTask({
      description: "same agent appears in multiple task links",
      assignedAgentId: agent.id,
      source: { sourceType: "agent_heartbeat", sourceAgentId: agent.id },
      tokenUsage: {
        inputTokens: 10,
        outputTokens: 4,
        cachedTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 14,
        firstUsedAt: "2026-05-13T09:00:00.000Z",
        lastUsedAt: "2026-05-13T11:00:00.000Z",
      },
    });

    const totals = aggregateTaskTokenTotalsByAgentLink(harness.store().getDatabase()).get(agent.id);

    expect(totals).toMatchObject({ inputTokens: 60, cachedTokens: 5, cacheWriteTokens: 1, outputTokens: 16, totalTokens: 82, nTasks: 3 });
  });

  it("aggregates usage across windows", async () => {
    const agent = await agentStore.createAgent({ name: "exec", role: "executor" });
    await harness.store().createTask({
      description: "recent",
      assignedAgentId: agent.id,
      tokenUsage: {
        inputTokens: 100,
        outputTokens: 10,
        cachedTokens: 50,
        cacheWriteTokens: 5,
        totalTokens: 165,
        firstUsedAt: "2026-05-13T09:00:00.000Z",
        lastUsedAt: "2026-05-13T11:00:00.000Z",
      },
    });
    await harness.store().createTask({
      description: "older",
      assignedAgentId: agent.id,
      tokenUsage: {
        inputTokens: 40,
        outputTokens: 4,
        cachedTokens: 10,
        cacheWriteTokens: 1,
        totalTokens: 55,
        firstUsedAt: "2026-05-05T09:00:00.000Z",
        lastUsedAt: "2026-05-05T11:00:00.000Z",
      },
    });

    const result = await aggregateAgentTokenUsage({
      taskStore: harness.store(),
      agentStore,
      agentId: agent.id,
      now: new Date("2026-05-13T12:00:00.000Z"),
    });

    expect(result).not.toBeNull();
    expect(result?.allTime).toMatchObject({ totalInputTokens: 140, totalCachedTokens: 60, totalCacheWriteTokens: 6, totalOutputTokens: 14, nTasks: 2 });
    expect(result?.last24h).toMatchObject({ totalInputTokens: 100, totalCachedTokens: 50, totalCacheWriteTokens: 5, totalOutputTokens: 10, nTasks: 1 });
    expect(result?.last7d).toMatchObject({ totalInputTokens: 100, totalCachedTokens: 50, totalCacheWriteTokens: 5, totalOutputTokens: 10, nTasks: 1 });
  });
});
