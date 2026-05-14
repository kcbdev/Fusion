import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AgentStore, type AgentCreateInput, type Task } from "@fusion/core";
import { describe, expect, it, vi } from "vitest";

import { attachAgentLinkSync } from "../task-agent-sync";

class EventedStore extends EventEmitter {
  on(event: "task:moved", listener: (data: { task: Task; from: string; to: string }) => void): this {
    return super.on(event, listener);
  }
  off(event: "task:moved", listener: (data: { task: Task; from: string; to: string }) => void): this {
    return super.off(event, listener);
  }
}

const createInput: AgentCreateInput = { name: "durable-agent", role: "executor" };

describe("FN-4296: task agent sync", () => {
  const runCase = async (to: string, hasActiveAgentExecution = false) => {
    const store = new EventedStore();
    const agentStore = {
      listAgents: vi.fn(async () => [{ id: "agent-1", taskId: "FN-1" }]),
      syncExecutionTaskLink: vi.fn(async () => undefined),
      assignTask: vi.fn(async () => undefined),
    } as any;

    const detach = attachAgentLinkSync({
      store: store as any,
      agentStore,
      hasActiveAgentExecution: () => hasActiveAgentExecution,
      logger: { log: vi.fn(), warn: vi.fn() },
    });

    store.emit("task:moved", { task: { id: "FN-1" }, from: "in-progress", to });
    await Promise.resolve();
    await Promise.resolve();

    return { detach, agentStore };
  };

  it("FN-4296: task:moved → done clears linked durable agent's taskId", async () => {
    const { agentStore } = await runCase("done");
    expect(agentStore.syncExecutionTaskLink).toHaveBeenCalledWith("agent-1", undefined);
  });

  it("FN-4296: task:moved → archived clears link", async () => {
    const { agentStore } = await runCase("archived");
    expect(agentStore.syncExecutionTaskLink).toHaveBeenCalledWith("agent-1", undefined);
  });

  it("FN-4296: task:moved → todo clears link when no in-flight execution", async () => {
    const { agentStore } = await runCase("todo", false);
    expect(agentStore.syncExecutionTaskLink).toHaveBeenCalledWith("agent-1", undefined);
  });

  it("FN-4296: task:moved → todo does NOT clear link when hasActiveAgentExecution=true", async () => {
    const { agentStore } = await runCase("todo", true);
    expect(agentStore.syncExecutionTaskLink).not.toHaveBeenCalled();
  });

  it("FN-4296: task:moved → triage clears link", async () => {
    const { agentStore } = await runCase("triage", false);
    expect(agentStore.syncExecutionTaskLink).toHaveBeenCalledWith("agent-1", undefined);
  });

  it("FN-4296: task:moved → in-review does NOT clear link", async () => {
    const { agentStore } = await runCase("in-review", false);
    expect(agentStore.syncExecutionTaskLink).not.toHaveBeenCalled();
  });

  it("FN-4296: task:moved → in-progress does NOT clear link", async () => {
    const { agentStore } = await runCase("in-progress", false);
    expect(agentStore.syncExecutionTaskLink).not.toHaveBeenCalled();
  });

  it("FN-4296: returned detach function unsubscribes the listener", async () => {
    const store = new EventedStore();
    const agentStore = {
      listAgents: vi.fn(async () => [{ id: "agent-1", taskId: "FN-1" }]),
      syncExecutionTaskLink: vi.fn(async () => undefined),
      assignTask: vi.fn(async () => undefined),
    } as any;
    const detach = attachAgentLinkSync({ store: store as any, agentStore, logger: { log: vi.fn(), warn: vi.fn() } });
    detach();
    store.emit("task:moved", { task: { id: "FN-1" }, from: "in-progress", to: "done" });
    await Promise.resolve();
    expect(agentStore.syncExecutionTaskLink).not.toHaveBeenCalled();
  });

  it("FN-4296: clear uses syncExecutionTaskLink not assignTask", async () => {
    const { agentStore } = await runCase("done", false);
    expect(agentStore.syncExecutionTaskLink).toHaveBeenCalled();
    expect(agentStore.assignTask).not.toHaveBeenCalled();
  });

  it("FN-4296: integration-flavored clear persists on real AgentStore", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "fn-4296-agent-store-"));
    try {
      const store = new EventedStore();
      const agentStore = new AgentStore({ rootDir, inMemoryDb: true });
      const created = await agentStore.createAgent(createInput);
      await agentStore.syncExecutionTaskLink(created.id, "FN-REAL");

      const logger = { log: vi.fn(), warn: vi.fn() };
      const detach = attachAgentLinkSync({
        store: store as any,
        agentStore,
        logger,
      });

      store.emit("task:moved", { task: { id: "FN-REAL" } as Task, from: "in-progress", to: "done" });

      let hydrated = await agentStore.getAgent(created.id);
      for (let attempt = 0; attempt < 10 && hydrated?.taskId; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        hydrated = await agentStore.getAgent(created.id);
      }

      expect(logger.warn).not.toHaveBeenCalled();
      expect(hydrated?.taskId).toBeUndefined();
      detach();
      await agentStore.close();
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
