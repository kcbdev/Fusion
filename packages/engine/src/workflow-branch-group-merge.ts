import type { Settings, Task } from "@fusion/core";

export interface BranchGroupWorkflowInput {
  task: Pick<Task, "id" | "branchContext" | "autoMerge">;
  settings: Pick<Settings, "autoMerge">;
  groupAutoMerge?: boolean;
}

export type BranchGroupWorkflowStage = "member-integration" | "group-promotion";

export interface BranchGroupWorkflowDecision {
  stage: BranchGroupWorkflowStage;
  allowed: boolean;
  outcome: "success" | "manual-required";
  reason?: string;
}

// FNXC:Branch-Groups – Implements user-facing branch-group member integration policy: shared branches always integrate; non-shared branches require global auto-merge enabled (2026-06-09 S11)
export function decideBranchGroupMemberIntegration(input: BranchGroupWorkflowInput): BranchGroupWorkflowDecision {
  const assignmentMode = input.task.branchContext?.assignmentMode;
  const isSharedMember = assignmentMode === "shared";
  if (!isSharedMember) {
    if (input.settings.autoMerge === false) {
      return {
        stage: "member-integration",
        allowed: false,
        outcome: "manual-required",
        reason: "global-auto-merge-disabled",
      };
    }
    return { stage: "member-integration", allowed: true, outcome: "success" };
  }
  return { stage: "member-integration", allowed: true, outcome: "success" };
}

// FNXC:Branch-Groups – Implements user-facing branch-group promotion policy: requires both global and group-level auto-merge enabled (2026-06-09 S11)
export function decideBranchGroupPromotion(input: BranchGroupWorkflowInput): BranchGroupWorkflowDecision {
  if (input.settings.autoMerge === false) {
    return {
      stage: "group-promotion",
      allowed: false,
      outcome: "manual-required",
      reason: "global-auto-merge-disabled",
    };
  }
  if (input.groupAutoMerge === false) {
    return {
      stage: "group-promotion",
      allowed: false,
      outcome: "manual-required",
      reason: "group-auto-merge-disabled",
    };
  }
  return { stage: "group-promotion", allowed: true, outcome: "success" };
}
