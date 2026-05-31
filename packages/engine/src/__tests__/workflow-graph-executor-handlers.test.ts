import { describe, expect, it, vi } from "vitest";
import { BUILTIN_CODING_WORKFLOW_IR } from "@fusion/core";
import type { TaskDetail, WorkflowIr } from "@fusion/core";

import { WorkflowGraphExecutor } from "../workflow-graph-executor.js";

const task = { id: "FN-5767" } as TaskDetail;

function settingsOn() {
  return { experimentalFeatures: { workflowGraphExecutor: true } };
}

describe("WorkflowGraphExecutor traversal", () => {
  it("walks linear graph", async () => {
    const ir: WorkflowIr = {
      version: "v1",
      name: "linear",
      nodes: [
        { id: "start", kind: "start" },
        { id: "a", kind: "prompt" },
        { id: "end", kind: "end" },
      ],
      edges: [
        { from: "start", to: "a" },
        { from: "a", to: "end", condition: "success" },
      ],
    };
    const handler = vi.fn(async () => ({ outcome: "success" as const }));
    const executor = new WorkflowGraphExecutor({ handlers: { prompt: handler } });

    const result = await executor.run(task, settingsOn(), ir);
    expect(result.outcome).toBe("success");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("routes failure edges", async () => {
    const ir: WorkflowIr = {
      version: "v1",
      name: "failure-route",
      nodes: [
        { id: "start", kind: "start" },
        { id: "a", kind: "prompt" },
        { id: "b", kind: "script" },
        { id: "end", kind: "end" },
      ],
      edges: [
        { from: "start", to: "a" },
        { from: "a", to: "b", condition: "failure" },
        { from: "b", to: "end", condition: "success" },
      ],
    };
    const executor = new WorkflowGraphExecutor({
      handlers: {
        prompt: async () => ({ outcome: "failure" }),
        script: async () => ({ outcome: "success" }),
      },
    });

    const result = await executor.run(task, settingsOn(), ir);
    expect(result.visitedNodeIds).toContain("b");
  });

  it("supports outcome:value conditions", async () => {
    const ir: WorkflowIr = {
      version: "v1",
      name: "outcome-value",
      nodes: [
        { id: "start", kind: "start" },
        { id: "a", kind: "prompt" },
        { id: "left", kind: "script" },
        { id: "right", kind: "script" },
        { id: "end", kind: "end" },
      ],
      edges: [
        { from: "start", to: "a" },
        { from: "a", to: "left", condition: "outcome:left" },
        { from: "a", to: "right", condition: "outcome:right" },
        { from: "left", to: "end" },
        { from: "right", to: "end" },
      ],
    };
    const script = vi.fn(async () => ({ outcome: "success" as const }));
    const executor = new WorkflowGraphExecutor({
      handlers: {
        prompt: async () => ({ outcome: "success", value: "right" }),
        script,
      },
    });

    const result = await executor.run(task, settingsOn(), ir);
    expect(result.visitedNodeIds).toContain("right");
    expect(result.visitedNodeIds).not.toContain("left");
  });

  it("leaves outcome unchanged when outcome:value does not match any edge", async () => {
    const ir: WorkflowIr = {
      version: "v1",
      name: "outcome-miss",
      nodes: [
        { id: "start", kind: "start" },
        { id: "a", kind: "prompt" },
        { id: "left", kind: "script" },
        { id: "right", kind: "script" },
        { id: "end", kind: "end" },
      ],
      edges: [
        { from: "start", to: "a" },
        { from: "a", to: "left", condition: "outcome:left" },
        { from: "a", to: "right", condition: "outcome:right" },
      ],
    };

    const executor = new WorkflowGraphExecutor({ handlers: { prompt: async () => ({ outcome: "success", value: "miss" }) } });
    const result = await executor.run(task, settingsOn(), ir);
    expect(result.outcome).toBe("success");
    expect(result.visitedNodeIds).not.toContain("left");
    expect(result.visitedNodeIds).not.toContain("right");
  });

  it("caps retries and converts exceptions to failure", async () => {
    const ir: WorkflowIr = {
      version: "v1",
      name: "retry",
      nodes: [
        { id: "start", kind: "start" },
        { id: "a", kind: "prompt" },
        { id: "end", kind: "end" },
      ],
      edges: [
        { from: "start", to: "a" },
        { from: "a", to: "end", condition: "failure" },
      ],
    };
    const handler = vi.fn(async () => {
      throw new Error("boom");
    });
    const executor = new WorkflowGraphExecutor({ handlers: { prompt: handler }, maxRetriesPerNode: 3 });

    const result = await executor.run(task, settingsOn(), ir);
    expect(handler).toHaveBeenCalledTimes(3);
    expect(result.outcome).toBe("failure");
  });

  it("fan-out executes deterministic sorted order", async () => {
    const ir: WorkflowIr = {
      version: "v1",
      name: "fanout",
      nodes: [
        { id: "start", kind: "start" },
        { id: "a", kind: "prompt" },
        { id: "b", kind: "script" },
        { id: "c", kind: "script" },
        { id: "end", kind: "end" },
      ],
      edges: [
        { from: "start", to: "a" },
        { from: "a", to: "c" },
        { from: "a", to: "b" },
        { from: "b", to: "end" },
        { from: "c", to: "end" },
      ],
    };
    const order: string[] = [];
    const executor = new WorkflowGraphExecutor({
      handlers: {
        prompt: async () => ({ outcome: "success" }),
        script: async (node) => {
          order.push(node.id);
          return { outcome: "success" };
        },
      },
    });
    await executor.run(task, settingsOn(), ir);
    expect(order).toEqual(["b", "c"]);
  });

  it("builtin coding workflow ir exposes expected lifecycle nodes", () => {
    expect(BUILTIN_CODING_WORKFLOW_IR.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining(["start", "execute", "review", "merge", "end"]),
    );
  });

  it("rejects malformed cyclic graphs", async () => {
    const ir: WorkflowIr = {
      version: "v1",
      name: "cycle",
      nodes: [
        { id: "start", kind: "start" },
        { id: "a", kind: "prompt" },
        { id: "end", kind: "end" },
      ],
      edges: [
        { from: "start", to: "a" },
        { from: "a", to: "a" },
      ],
    };
    const executor = new WorkflowGraphExecutor({ handlers: { prompt: async () => ({ outcome: "success" }) } });

    await expect(executor.run(task, settingsOn(), ir)).rejects.toThrow("Cycle detected");
  });
});
