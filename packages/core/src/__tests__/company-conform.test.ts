// @vitest-environment node
//
// U12 (R17): on-demand convert-to-simple conform mapping. Mirrors the migration's
// trait-id classification, carries unclassifiable columns as custom columns
// between in-progress and in-review, and always yields a valid company-model IR.

import { describe, expect, it } from "vitest";
import { buildCompanyConformPlan, CompanyConformError } from "../company-conform.js";
import { COMPANY_BOARD_TEMPLATE_IR, isCompanyBoardIr } from "../company-board-template.js";
import { parseWorkflowIr } from "../workflow-ir.js";
import "../builtin-traits.js";
import type { WorkflowIr } from "../workflow-ir-types.js";

/** A legacy-ish non-default v2 workflow with an extra "deploy" column. */
function legacyWorkflow(): WorkflowIr {
  return parseWorkflowIr({
    version: "v2",
    name: "legacy-custom",
    columns: [
      { id: "intake-col", name: "Backlog", traits: [{ trait: "intake" }] },
      { id: "build", name: "Build", traits: [{ trait: "wip" }] },
      { id: "qa", name: "QA", traits: [{ trait: "merge-blocker" }] },
      { id: "deploy", name: "Deploy", traits: [] },
      { id: "shipped", name: "Shipped", traits: [{ trait: "complete" }] },
      { id: "trash", name: "Trash", traits: [{ trait: "archived" }] },
    ],
    nodes: [
      { id: "start", kind: "start", column: "build" },
      { id: "end", kind: "end", column: "shipped" },
    ],
    edges: [{ from: "start", to: "end" }],
  });
}

describe("buildCompanyConformPlan (U12 R17)", () => {
  it("maps role-region columns onto the company template by trait classification", () => {
    const { mappings } = buildCompanyConformPlan(legacyWorkflow());
    const byFrom = new Map(mappings.map((m) => [m.fromColumnId, m]));
    expect(byFrom.get("intake-col")?.toColumnId).toBe("todo");
    expect(byFrom.get("intake-col")?.role).toBe("lead");
    expect(byFrom.get("build")?.toColumnId).toBe("in-progress");
    expect(byFrom.get("build")?.role).toBe("executor");
    expect(byFrom.get("qa")?.toColumnId).toBe("in-review");
    expect(byFrom.get("qa")?.role).toBe("reviewer");
    expect(byFrom.get("shipped")?.toColumnId).toBe("done");
    expect(byFrom.get("trash")?.toColumnId).toBe("archived");
  });

  it("carries an unclassifiable column as a custom column placed between in-progress and in-review", () => {
    const { mappings, conformedIr } = buildCompanyConformPlan(legacyWorkflow());
    const deploy = mappings.find((m) => m.fromColumnId === "deploy");
    expect(deploy?.carried).toBe(true);
    // deploy keeps its own id (no collision with reserved template ids).
    expect(deploy?.toColumnId).toBeNull();

    expect(conformedIr.version).toBe("v2");
    if (conformedIr.version !== "v2") throw new Error("expected v2");
    const ids = conformedIr.columns.map((c) => c.id);
    const inProgressIdx = ids.indexOf("in-progress");
    const deployIdx = ids.indexOf("deploy");
    const inReviewIdx = ids.indexOf("in-review");
    expect(deployIdx).toBeGreaterThan(inProgressIdx);
    expect(deployIdx).toBeLessThan(inReviewIdx);
  });

  it("produces a valid company-model IR (role markers present, linear)", () => {
    const { conformedIr } = buildCompanyConformPlan(legacyWorkflow());
    expect(isCompanyBoardIr(conformedIr)).toBe(true);
  });

  it("throws a typed CompanyConformError (not a raw WorkflowIrError) when a carried column's agent binding is structurally invalid", () => {
    // A v2 IR (constructed directly, bypassing the initial parse) whose
    // unclassifiable column carries a malformed agent binding (invalid mode). The
    // bad binding is copied onto the carried custom column, so parseWorkflowIr of
    // the ASSEMBLED conformed IR throws — buildCompanyConformPlan must re-point it
    // into a typed, descriptive CompanyConformError instead of leaking the raw
    // WorkflowIrError to the dashboard route's generic error mapper.
    const bad: WorkflowIr = {
      version: "v2",
      name: "bad-carry",
      columns: [
        { id: "build", name: "Build", traits: [{ trait: "wip" }] },
        {
          id: "deploy",
          name: "Deploy",
          traits: [],
          // @ts-expect-error intentionally malformed agent binding (invalid mode)
          agent: { agentId: "a1", mode: "nope" },
        },
      ],
      nodes: [
        { id: "start", kind: "start", column: "build" },
        { id: "end", kind: "end", column: "build" },
      ],
      edges: [{ from: "start", to: "end" }],
    };
    expect(() => buildCompanyConformPlan(bad)).toThrow(CompanyConformError);
    try {
      buildCompanyConformPlan(bad);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(CompanyConformError);
      expect((err as CompanyConformError).message).toContain("carried custom column");
    }
  });

  it("is a near no-op for a board already on the company template (no role rewrites carried)", () => {
    const { mappings, conformedIr } = buildCompanyConformPlan(COMPANY_BOARD_TEMPLATE_IR);
    expect(isCompanyBoardIr(conformedIr)).toBe(true);
    // The template's own columns classify onto themselves; none are carried as
    // custom columns.
    expect(mappings.every((m) => !m.carried)).toBe(true);
  });
});
