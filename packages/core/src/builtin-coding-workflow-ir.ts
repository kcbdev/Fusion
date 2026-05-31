import type { WorkflowIr } from "./workflow-ir-types.js";
import { parseWorkflowIr } from "./workflow-ir.js";

const RAW_BUILTIN_CODING_WORKFLOW_IR: WorkflowIr = {
  version: "v1",
  name: "builtin-coding-workflow",
  nodes: [
    { id: "start", kind: "start" },
    { id: "execute", kind: "prompt", config: { seam: "execute" } },
    { id: "review", kind: "prompt", config: { seam: "review" } },
    { id: "merge", kind: "prompt", config: { seam: "merge" } },
    { id: "end", kind: "end" },
  ],
  edges: [
    { from: "start", to: "execute" },
    { from: "execute", to: "review", condition: "success" },
    { from: "review", to: "merge", condition: "success" },
    { from: "merge", to: "end", condition: "success" },
    { from: "execute", to: "end", condition: "failure" },
    { from: "review", to: "end", condition: "failure" },
    { from: "merge", to: "end", condition: "failure" },
  ],
};

export const BUILTIN_CODING_WORKFLOW_IR = parseWorkflowIr(RAW_BUILTIN_CODING_WORKFLOW_IR);
