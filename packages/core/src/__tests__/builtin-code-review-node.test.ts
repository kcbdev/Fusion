import { describe, expect, it } from "vitest";
import {
  CODE_REVIEW_NODE_ID,
  codeReviewStepNode,
} from "../builtin-code-review-node.js";
import { BUILTIN_CODING_WORKFLOW_IR } from "../builtin-coding-workflow-ir.js";
import { BUILTIN_STEPWISE_CODING_WORKFLOW_IR } from "../builtin-stepwise-coding-workflow-ir.js";
import { WORKFLOW_STEP_TEMPLATES } from "../types.js";
import { parseWorkflowIr, serializeWorkflowIr } from "../workflow-ir.js";
import { resolveWorkflowOptionalSteps } from "../workflow-optional-steps.js";

/*
FNXC:CodeReviewStep 2026-06-25-13:30:
Coverage for the STANDARD, always-on "Code Review" pre-merge step: the catalog template
fields, the regular `prompt` node built from it, and its wiring as a default-ON step in
the coding + stepwise built-ins (no enabledWorkflowSteps gating). Code review is a
WORKFLOW prompt step (shared verdict machinery), not engine verification code.
*/

describe("code-review WORKFLOW_STEP_TEMPLATE", () => {
  const template = WORKFLOW_STEP_TEMPLATES.find((t) => t.id === "code-review");

  it("exists with the expected catalog fields", () => {
    expect(template).toBeTruthy();
    expect(template!.name).toBe("Code Review");
    expect(template!.toolMode).toBe("readonly");
    // Advisory → non-blocking by default (like the existing review); operators can promote.
    expect(template!.gateMode).toBe("advisory");
    expect(template!.phase).toBe("pre-merge");
    expect(template!.description.length).toBeGreaterThan(0);
  });

  it("ends with the shared trailing verdict convention and reads the diff", () => {
    const prompt = template!.prompt;
    expect(prompt).toMatch(/"verdict":"APPROVE\|APPROVE_WITH_NOTES\|REVISE"/);
    expect(prompt).not.toContain('"verdict":"PASS"');
    expect(prompt).not.toContain('"verdict":"FAIL"');
    // Focused on the value tests miss + reads the diff against the base.
    expect(prompt).toMatch(/git diff/);
    expect(prompt).toMatch(/out of scope/i);
  });
});

describe("codeReviewStepNode", () => {
  it("builds a standard advisory readonly prompt node keyed by the catalog id", () => {
    const node = codeReviewStepNode("in-progress");
    expect(node.id).toBe(CODE_REVIEW_NODE_ID);
    expect(CODE_REVIEW_NODE_ID).toBe("code-review");
    // Standard node, NOT an optional-group toggle.
    expect(node.kind).toBe("prompt");
    expect(node.column).toBe("in-progress");
    expect(node.config?.name).toBe("Code Review");
    expect(node.config?.toolMode).toBe("readonly");
    expect(node.config?.gateMode).toBe("advisory");
    expect(node.config?.defaultOn).toBeUndefined(); // no optional-group toggle semantics.
    expect(String(node.config?.prompt)).toMatch(/"verdict":"APPROVE\|APPROVE_WITH_NOTES\|REVISE"/);
  });
});

describe("built-in coding + stepwise workflows wire code-review as a standard always-on step", () => {
  it.each([
    ["builtin coding", BUILTIN_CODING_WORKFLOW_IR],
    ["builtin stepwise", BUILTIN_STEPWISE_CODING_WORKFLOW_IR],
  ])("%s includes a default-ON code-review prompt node between browser-verification and review", (_name, ir) => {
    const byId = new Map(ir.nodes.map((n) => [n.id, n]));
    const node = byId.get("code-review");
    // Always present as a standard prompt node (not an optional-group, no toggle).
    expect(node?.kind).toBe("prompt");
    expect(node?.config?.name).toBe("Code Review");
    expect(node?.config?.gateMode).toBe("advisory");
    expect(node?.config?.toolMode).toBe("readonly");

    // Pre-merge wiring: ... → browser-verification → code-review → review; failure → end
    // (mirrors how the existing review node fails to end — no dead-end).
    expect(ir.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: "browser-verification", to: "code-review", condition: "success" }),
        expect.objectContaining({ from: "code-review", to: "review", condition: "success" }),
        expect.objectContaining({ from: "code-review", to: "end", condition: "failure" }),
      ]),
    );

    // The built-in still compiles/validates with the standard node (parse round-trips).
    const reparsed = parseWorkflowIr(serializeWorkflowIr(ir));
    expect(reparsed).toEqual(parseWorkflowIr(ir));
  });

  it.each([
    ["builtin coding", BUILTIN_CODING_WORKFLOW_IR],
    ["builtin stepwise", BUILTIN_STEPWISE_CODING_WORKFLOW_IR],
  ])("%s: code-review is NOT advertised as an optional-step toggle (always-on, no gating)", (_name, ir) => {
    // Standard step → never surfaces in the optional-step toggle list (it is not gated
    // on task.enabledWorkflowSteps; it runs for every coding task).
    const toggles = resolveWorkflowOptionalSteps(ir).map((s) => s.templateId);
    expect(toggles).not.toContain("code-review");
  });
});
