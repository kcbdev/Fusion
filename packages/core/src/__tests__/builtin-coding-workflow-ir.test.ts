import { describe, expect, it } from "vitest";
import { BUILTIN_CODING_WORKFLOW_IR, parseWorkflowIr, serializeWorkflowIr } from "../index.js";

describe("builtin coding workflow ir", () => {
  it("parses and round-trips", () => {
    const parsed = parseWorkflowIr(BUILTIN_CODING_WORKFLOW_IR);
    const reparsed = parseWorkflowIr(serializeWorkflowIr(parsed));
    expect(reparsed).toEqual(parsed);
    expect(parsed.version).toBe("v1");
  });

  it("contains exactly one start and one end node", () => {
    const nodes = BUILTIN_CODING_WORKFLOW_IR.nodes;
    expect(nodes.filter((node) => node.kind === "start")).toHaveLength(1);
    expect(nodes.filter((node) => node.kind === "end")).toHaveLength(1);
  });

  it("exposes coding lifecycle seams", () => {
    const seams = BUILTIN_CODING_WORKFLOW_IR.nodes
      .map((node) => String(node.config?.seam ?? ""))
      .filter((seam) => seam.length > 0);
    expect(seams).toEqual(expect.arrayContaining(["execute", "review", "merge"]));
    expect(seams).not.toContain("triage");
  });
});
