import { WorkflowIrError } from "@fusion/core";
import type { TaskDetail } from "@fusion/core";

import type { WorkflowNodeHandler, WorkflowNodeResult } from "./workflow-graph-executor.js";

export type WorkflowSeamName = "execute" | "review" | "merge" | "schedule";

export interface WorkflowLegacySeams {
  execute: (task: TaskDetail, context: Record<string, unknown>) => Promise<WorkflowNodeResult>;
  review: (task: TaskDetail, context: Record<string, unknown>) => Promise<WorkflowNodeResult>;
  merge: (task: TaskDetail, context: Record<string, unknown>) => Promise<WorkflowNodeResult>;
  schedule: (task: TaskDetail, context: Record<string, unknown>) => Promise<WorkflowNodeResult>;
}

function resolveSeam(node: { config?: Record<string, unknown> }): WorkflowSeamName {
  const seam = node.config?.seam;
  if (seam === "execute" || seam === "review" || seam === "merge" || seam === "schedule") {
    return seam;
  }
  throw new WorkflowIrError(`Unsupported workflow seam: ${String(seam)}`);
}

export function createPromptLikeHandler(seams: WorkflowLegacySeams): WorkflowNodeHandler {
  return async (node, context) => {
    const seam = resolveSeam(node);
    return seams[seam](context.task, context.context);
  };
}

export const gateNodeHandler: WorkflowNodeHandler = async (node, context) => {
  const expected = node.config?.expect;
  const actual = context.context[String(node.config?.contextKey ?? "outcome")];
  if (typeof expected === "string" && actual !== expected) {
    return { outcome: "failure", value: "gate-mismatch" };
  }
  return { outcome: "success" };
};

export function createDefaultNodeHandlers(seams: WorkflowLegacySeams): Record<"prompt" | "script" | "gate", WorkflowNodeHandler> {
  const promptLike = createPromptLikeHandler(seams);
  return {
    prompt: promptLike,
    script: promptLike,
    gate: gateNodeHandler,
  };
}

export function createNoopLegacySeams(): WorkflowLegacySeams {
  const success = async (): Promise<WorkflowNodeResult> => ({ outcome: "success" });
  return {
    execute: success,
    review: success,
    merge: success,
    schedule: success,
  };
}
