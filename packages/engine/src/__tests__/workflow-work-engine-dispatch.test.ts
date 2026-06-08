// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WORKFLOW_EXTENSION_SCHEMA_VERSION,
  __resetWorkflowExtensionRegistryForTests,
  getWorkflowExtensionRegistry,
  workflowExtensionRegistryId,
  type Task,
  type TaskDetail,
  type WorkflowIr,
} from "@fusion/core";
import { TaskExecutor } from "../executor.js";

describe("workflow work-engine dispatch", () => {
  afterEach(() => {
    __resetWorkflowExtensionRegistryForTests();
  });

  it("lets a plugin work engine claim a task from column extension metadata", async () => {
    const extensionKey = workflowExtensionRegistryId("engine-plugin", "custom-dispatch");
    const task = {
      id: "FN-WORK",
      column: "in-progress",
      title: "plugin work",
      description: "plugin work",
    } as TaskDetail;
    const workflow: WorkflowIr = {
      version: "v2",
      name: "custom",
      columns: [
        { id: "todo", name: "Todo", traits: [] },
        {
          id: "in-progress",
          name: "Running",
          traits: [],
          extensions: { [extensionKey]: { lane: "custom" } },
        },
      ],
      nodes: [],
      edges: [],
    };
    const dispatch = vi.fn().mockResolvedValue({
      kind: "claimed",
      runId: "plugin-run-1",
      message: "claimed by plugin",
    });
    getWorkflowExtensionRegistry().register("engine-plugin", {
      extensionId: "custom-dispatch",
      name: "Custom dispatch",
      kind: "work-engine",
      schemaVersion: WORKFLOW_EXTENSION_SCHEMA_VERSION,
      fallback: "failClosed",
      dispatch,
    });

    const store = {
      on: vi.fn(),
      getTask: vi.fn().mockResolvedValue(task),
      getTaskWorkflowSelection: vi.fn().mockReturnValue({ workflowId: "custom-workflow", stepIds: [] }),
      getWorkflowDefinition: vi.fn().mockResolvedValue({ ir: workflow }),
      logEntry: vi.fn().mockResolvedValue(undefined),
      recordRunAuditEvent: vi.fn().mockResolvedValue(undefined),
      updateTask: vi.fn().mockResolvedValue(undefined),
    };
    const executor = new TaskExecutor(store as any, "/tmp/fusion-work-engine-test");

    const claimed = await (executor as any).maybeDispatchWorkflowWorkEngine(task as Task);

    expect(claimed).toBe(true);
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      task,
      workflow,
      columnId: "in-progress",
      metadata: { lane: "custom" },
    }));
    expect(store.logEntry).toHaveBeenCalledWith("FN-WORK", "claimed by plugin");
    expect(store.recordRunAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      mutationType: "workflow:work-engine:claimed",
      metadata: expect.objectContaining({ extensionId: extensionKey, pluginId: "engine-plugin" }),
    }));
    expect(store.updateTask).not.toHaveBeenCalled();
  });
});
