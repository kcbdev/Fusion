import { WORKFLOW_STEP_TEMPLATES } from "@fusion/core";
import { describe, expect, it } from "vitest";
import { inferWorkflowStepVerdictFromProse, parseWorkflowStepVerdict } from "../executor.js";

const TARGET_TEMPLATE_IDS = [
  "documentation-review",
  "qa-check",
  "security-audit",
  "performance-review",
  "accessibility-check",
  "browser-verification",
  "frontend-ux-design",
] as const;

describe("workflow step template verdict interoperability", () => {
  it.each(TARGET_TEMPLATE_IDS)("%s supports canonical JSON and prose fallback", (id) => {
    const template = WORKFLOW_STEP_TEMPLATES.find((entry) => entry.id === id);
    expect(template).toBeTruthy();

    const promptBody = template!.prompt;
    expect(promptBody).toContain('"verdict":"APPROVE|APPROVE_WITH_NOTES|REVISE"');

    expect(parseWorkflowStepVerdict('{"verdict":"APPROVE","notes":""}')).toEqual({
      verdict: "APPROVE",
      notes: "",
    });
    expect(parseWorkflowStepVerdict(`{"verdict":"APPROVE","notes":"out of scope: ${id}"}`)).toEqual({
      verdict: "APPROVE",
      notes: `out of scope: ${id}`,
    });
    expect(parseWorkflowStepVerdict(`{"verdict":"APPROVE_WITH_NOTES","notes":"advisory only: ${id}"}`)).toEqual({
      verdict: "APPROVE_WITH_NOTES",
      notes: `advisory only: ${id}`,
    });
    expect(inferWorkflowStepVerdictFromProse("REQUEST REVISION\nfix packages/foo.ts")).toEqual({
      verdict: "REVISE",
      notes: "fix packages/foo.ts",
    });
  });
});
