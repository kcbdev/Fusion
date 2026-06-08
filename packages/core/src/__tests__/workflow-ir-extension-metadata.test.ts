import { describe, expect, it } from "vitest";
import {
  downgradeIrToV1IfPure,
  parseWorkflowIr,
} from "../workflow-ir.js";
import type { WorkflowIrV2 } from "../workflow-ir-types.js";

function ir(overrides: Partial<WorkflowIrV2> = {}): WorkflowIrV2 {
  return {
    version: "v2",
    name: "extensions",
    columns: [{ id: "todo", name: "todo", traits: [] }],
    nodes: [
      { id: "start", kind: "start", column: "todo" },
      { id: "end", kind: "end", column: "todo" },
    ],
    edges: [{ from: "start", to: "end" }],
    ...overrides,
  };
}

describe("workflow IR extension metadata", () => {
  it("accepts plugin-namespaced column and node extension metadata", () => {
    const parsed = parseWorkflowIr(ir({
      columns: [
        {
          id: "todo",
          name: "todo",
          traits: [],
          extensions: {
            "plugin:workflow-pack:role": { role: "lead" },
          },
        },
      ],
      nodes: [
        {
          id: "start",
          kind: "start",
          column: "todo",
          extensions: {
            "plugin:workflow-pack:node-handler": { handler: "plan" },
          },
        },
        { id: "end", kind: "end", column: "todo" },
      ],
    }));

    expect(parsed.version).toBe("v2");
    if (parsed.version !== "v2") throw new Error("expected v2");
    expect(parsed.columns[0].extensions?.["plugin:workflow-pack:role"]).toEqual({ role: "lead" });
    expect(parsed.nodes[0].extensions?.["plugin:workflow-pack:node-handler"]).toEqual({ handler: "plan" });
  });

  it("rejects extension metadata keys outside the plugin namespace", () => {
    expect(() =>
      parseWorkflowIr(ir({
        columns: [
          {
            id: "todo",
            name: "todo",
            traits: [],
            extensions: { role: { role: "lead" } },
          },
        ],
      })),
    ).toThrow(/must be plugin-namespaced/);
  });

  it("rejects non-object extension metadata values", () => {
    expect(() =>
      parseWorkflowIr(ir({
        nodes: [
          {
            id: "start",
            kind: "start",
            column: "todo",
            extensions: { "plugin:workflow-pack:node-handler": "plan" as never },
          },
          { id: "end", kind: "end", column: "todo" },
        ],
      })),
    ).toThrow(/metadata must be an object/);
  });

  it("keeps v2 when otherwise-pure workflows carry extension metadata", () => {
    const parsed = parseWorkflowIr(ir({
      columns: [
        {
          id: "triage",
          name: "triage",
          traits: [],
          extensions: { "plugin:workflow-pack:role": { role: "lead" } },
        },
        { id: "todo", name: "todo", traits: [] },
        { id: "in-progress", name: "in-progress", traits: [] },
        { id: "in-review", name: "in-review", traits: [] },
        { id: "done", name: "done", traits: [] },
        { id: "archived", name: "archived", traits: [] },
      ],
    }));

    expect(downgradeIrToV1IfPure(parsed).version).toBe("v2");
  });
});
