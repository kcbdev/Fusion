import type { WorkflowIr } from "./workflow-ir-types.js";
import { parseWorkflowIr } from "./workflow-ir.js";
import { BUILTIN_STEPWISE_CODING_WORKFLOW_IR } from "./builtin-stepwise-coding-workflow-ir.js";

function cloneWorkflowIr(ir: WorkflowIr): WorkflowIr {
  return JSON.parse(JSON.stringify(ir)) as WorkflowIr;
}

/*
FNXC:WorkflowBuiltins 2026-06-28-23:09:
Operators need graph-owned step execution without per-step AI review. This built-in preserves the per-step-review workflow's parse-steps and sequential foreach model, then runs the normal end-of-task browser/code-review/final-review/merge suffix after all planned steps finish.
*/
const RAW_BUILTIN_STEPWISE_FINAL_REVIEW_CODING_WORKFLOW_IR: WorkflowIr = (() => {
  const ir = cloneWorkflowIr(BUILTIN_STEPWISE_CODING_WORKFLOW_IR);
  ir.name = "builtin-stepwise-final-review-coding";

  const foreach = ir.nodes.find((node) => node.id === "steps" && node.kind === "foreach");
  const template = foreach?.config?.template as
    | {
        nodes?: Array<{ id: string; kind: string; config?: Record<string, unknown> }>;
        edges?: Array<{ from: string; to: string; condition?: string; kind?: string }>;
      }
    | undefined;
  if (!template?.nodes || !template.edges) {
    throw new Error("stepwise final-review built-in requires the stepwise foreach template");
  }

  template.nodes = template.nodes.filter((node) => node.id !== "step-review");
  template.edges = [
    { from: "step-execute", to: "step-done", condition: "success" },
  ];

  ir.nodes = ir.nodes.filter((node) => node.id !== "rework-hold");
  ir.edges = ir.edges.filter(
    (edge) => edge.from !== "rework-hold" && edge.to !== "rework-hold",
  );

  return ir;
})();

export const BUILTIN_STEPWISE_FINAL_REVIEW_CODING_WORKFLOW_IR = parseWorkflowIr(
  RAW_BUILTIN_STEPWISE_FINAL_REVIEW_CODING_WORKFLOW_IR,
);
