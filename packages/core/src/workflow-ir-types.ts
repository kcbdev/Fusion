export type WorkflowIrNodeKind = "start" | "prompt" | "script" | "gate" | "end";

export interface WorkflowIrNode {
  id: string;
  kind: WorkflowIrNodeKind;
  config?: Record<string, unknown>;
}

export interface WorkflowIrEdge {
  from: string;
  to: string;
  condition?: string;
}

export interface WorkflowIr {
  version: "v1";
  name: string;
  nodes: WorkflowIrNode[];
  edges: WorkflowIrEdge[];
}
