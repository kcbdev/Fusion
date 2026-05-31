import type { WorkflowIr } from "./workflow-ir-types.js";

export class WorkflowIrError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowIrError";
  }
}

export function parseWorkflowIr(input: string | WorkflowIr): WorkflowIr {
  const value: unknown = typeof input === "string" ? JSON.parse(input) : input;
  if (!value || typeof value !== "object") {
    throw new WorkflowIrError("Workflow IR must be an object");
  }
  const ir = value as WorkflowIr;
  if (ir.version !== "v1") throw new WorkflowIrError("Workflow IR version must be v1");
  if (!Array.isArray(ir.nodes) || !Array.isArray(ir.edges)) {
    throw new WorkflowIrError("Workflow IR nodes/edges must be arrays");
  }
  const startCount = ir.nodes.filter((n) => n.kind === "start").length;
  const endCount = ir.nodes.filter((n) => n.kind === "end").length;
  if (startCount !== 1 || endCount !== 1) {
    throw new WorkflowIrError("Workflow IR must contain exactly one start and one end node");
  }
  return ir;
}

export function serializeWorkflowIr(ir: WorkflowIr): string {
  return JSON.stringify(ir, null, 2);
}
