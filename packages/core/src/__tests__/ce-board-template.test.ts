// @vitest-environment node
//
// Company-model U13: the Compound Engineering board template (CE-stage column
// engines). The template parses via parseWorkflowIr, extends the company template
// with per-column `ce-stage` engine bindings + a locked Compound column, and
// carries the per-board defaults (plan approval on, LFG off) plus the per-task LFG
// override helpers.

import { describe, expect, it } from "vitest";
import {
  CE_BOARD_TEMPLATE_IR,
  CE_BOARD_COLUMN_IDS,
  CE_BOARD_DEFAULTS,
  CE_RESPOND_LOOP_STAGE_ID,
  TASK_LFG_OVERRIDE_KEY,
  isCeBoardIr,
  resolveCeStageForColumn,
  resolveCePluginStageId,
  getTaskLfgOverride,
  resolveEffectiveLfgMode,
  withTaskLfgOverride,
} from "../ce-board-template.js";
import { isCompanyBoardIr, COMPANY_BOARD_TEMPLATE_IR } from "../company-board-template.js";
import { parseWorkflowIr, serializeWorkflowIr } from "../workflow-ir.js";
import type { Task } from "../types.js";

function asTask(customFields?: Record<string, unknown>): Pick<Task, "customFields"> {
  return { customFields };
}

describe("U13 CE board template", () => {
  it("parses and round-trips", () => {
    const parsed = parseWorkflowIr(CE_BOARD_TEMPLATE_IR);
    const reparsed = parseWorkflowIr(serializeWorkflowIr(parsed));
    expect(reparsed).toEqual(parsed);
    expect(parsed.version).toBe("v2");
  });

  it("extends the company template: idea → todo → in-progress → in-review → compound → done → archived", () => {
    if (CE_BOARD_TEMPLATE_IR.version !== "v2") throw new Error("expected v2");
    const ids = CE_BOARD_TEMPLATE_IR.columns.map((c) => c.id);
    expect(ids).toEqual([...CE_BOARD_COLUMN_IDS]);
    // The Compound column sits between in-review and done.
    expect(ids.indexOf("compound")).toBeGreaterThan(ids.indexOf("in-review"));
    expect(ids.indexOf("compound")).toBeLessThan(ids.indexOf("done"));
  });

  it("binds each working column to its CE stage via the engine field", () => {
    expect(resolveCeStageForColumn(CE_BOARD_TEMPLATE_IR, "todo")).toBe("ce-plan");
    expect(resolveCeStageForColumn(CE_BOARD_TEMPLATE_IR, "in-progress")).toBe("ce-work");
    expect(resolveCeStageForColumn(CE_BOARD_TEMPLATE_IR, "in-review")).toBe("ce-code-review");
    expect(resolveCeStageForColumn(CE_BOARD_TEMPLATE_IR, "compound")).toBe("ce-compound");
    // The intake / terminal columns carry no engine binding.
    expect(resolveCeStageForColumn(CE_BOARD_TEMPLATE_IR, "idea")).toBeUndefined();
    expect(resolveCeStageForColumn(CE_BOARD_TEMPLATE_IR, "done")).toBeUndefined();
  });

  it("keeps the company role markers + locks the Compound column", () => {
    if (CE_BOARD_TEMPLATE_IR.version !== "v2") throw new Error("expected v2");
    const byId = (id: string) => CE_BOARD_TEMPLATE_IR.columns.find((c) => c.id === id);
    expect(byId("todo")?.role).toBe("lead");
    expect(byId("in-progress")?.role).toBe("executor");
    expect(byId("in-review")?.role).toBe("reviewer");
    // Compound is locked (simple-mode editor cannot remove it) and has no role.
    expect(byId("compound")?.locked).toBe(true);
    expect(byId("compound")?.role).toBeUndefined();
  });

  it("is both a CE board and a company board", () => {
    expect(isCeBoardIr(CE_BOARD_TEMPLATE_IR)).toBe(true);
    // A CE board is a company board (role markers present).
    expect(isCompanyBoardIr(CE_BOARD_TEMPLATE_IR)).toBe(true);
    // The plain company template is NOT a CE board (no engine bindings).
    expect(isCeBoardIr(COMPANY_BOARD_TEMPLATE_IR)).toBe(false);
  });

  it("rejects a malformed engine binding through parseWorkflowIr", () => {
    if (CE_BOARD_TEMPLATE_IR.version !== "v2") throw new Error("expected v2");
    const bad = {
      ...CE_BOARD_TEMPLATE_IR,
      columns: CE_BOARD_TEMPLATE_IR.columns.map((c) =>
        c.id === "todo" ? { ...c, engine: { kind: "ce-stage", stageId: "" } } : c,
      ),
    };
    expect(() => parseWorkflowIr(bad)).toThrow(/stageId/);

    const badKind = {
      ...CE_BOARD_TEMPLATE_IR,
      columns: CE_BOARD_TEMPLATE_IR.columns.map((c) =>
        c.id === "todo" ? { ...c, engine: { kind: "bogus", stageId: "x" } } : c,
      ),
    };
    expect(() => parseWorkflowIr(badKind as never)).toThrow(/ce-stage/);
  });

  it("defaults plan approval ON and LFG OFF; respond loop binds to resolve-pr-feedback", () => {
    expect(CE_BOARD_DEFAULTS.requirePlanApproval).toBe(true);
    expect(CE_BOARD_DEFAULTS.lfgMode).toBe(false);
    expect(CE_RESPOND_LOOP_STAGE_ID).toBe("resolve-pr-feedback");
  });
});

describe("U13 per-task LFG override helpers (R22)", () => {
  it("getTaskLfgOverride reads the reserved customFields key as a tri-state", () => {
    expect(getTaskLfgOverride(asTask())).toBeUndefined();
    expect(getTaskLfgOverride(asTask({}))).toBeUndefined();
    expect(getTaskLfgOverride(asTask({ [TASK_LFG_OVERRIDE_KEY]: true }))).toBe(true);
    expect(getTaskLfgOverride(asTask({ [TASK_LFG_OVERRIDE_KEY]: false }))).toBe(false);
    // Malformed (non-boolean) values read as "no override".
    expect(getTaskLfgOverride(asTask({ [TASK_LFG_OVERRIDE_KEY]: "yes" }))).toBeUndefined();
  });

  it("resolveEffectiveLfgMode: per-task override wins, else the board default", () => {
    // No override → inherit the board.
    expect(resolveEffectiveLfgMode(asTask(), true)).toBe(true);
    expect(resolveEffectiveLfgMode(asTask(), false)).toBe(false);
    // Override → wins over the board default in both directions.
    expect(resolveEffectiveLfgMode(asTask({ [TASK_LFG_OVERRIDE_KEY]: false }), true)).toBe(false);
    expect(resolveEffectiveLfgMode(asTask({ [TASK_LFG_OVERRIDE_KEY]: true }), false)).toBe(true);
  });

  it("withTaskLfgOverride sets/clears the key without mutating or dropping siblings", () => {
    const base = { other: 1 };
    const set = withTaskLfgOverride(base, true);
    expect(set).toEqual({ other: 1, [TASK_LFG_OVERRIDE_KEY]: true });
    expect(base).toEqual({ other: 1 }); // input unchanged

    const cleared = withTaskLfgOverride(set, undefined);
    expect(cleared).toEqual({ other: 1 });
    expect(TASK_LFG_OVERRIDE_KEY in cleared).toBe(false);

    // From undefined customFields.
    expect(withTaskLfgOverride(undefined, false)).toEqual({ [TASK_LFG_OVERRIDE_KEY]: false });
  });
});

describe("U13 sub-part C — CE template compilability + plugin stage mapping", () => {
  it("CE_BOARD_TEMPLATE_IR compiles onto the linear WorkflowStep engine (no interpreter required)", async () => {
    const { validateLinearity, compileWorkflowToSteps } = await import("../workflow-compiler.js");
    // The compound node was linearized to a single post-merge step (success→end);
    // the merge seam keeps its failure→end edge. The whole graph is now linear.
    expect(validateLinearity(CE_BOARD_TEMPLATE_IR)).toBeNull();
    const steps = compileWorkflowToSteps(CE_BOARD_TEMPLATE_IR);
    // execute/review seams are skipped; merge is the pre/post boundary; the only
    // emitted user step is the post-merge `compound` step.
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ name: "compound", phase: "post-merge" });
  });

  it("resolveCePluginStageId maps ce-prefixed board stage ids to bare registry ids; respond-loop maps to itself", () => {
    expect(resolveCePluginStageId("ce-plan")).toBe("plan");
    expect(resolveCePluginStageId("ce-work")).toBe("work");
    expect(resolveCePluginStageId("ce-code-review")).toBe("code-review");
    expect(resolveCePluginStageId("ce-compound")).toBe("compound");
    // The respond-loop stage id has no ce- prefix → identity.
    expect(resolveCePluginStageId(CE_RESPOND_LOOP_STAGE_ID)).toBe("resolve-pr-feedback");
    // Idempotent on an already-bare id.
    expect(resolveCePluginStageId("plan")).toBe("plan");
  });
});
