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

/*
FNXC:Branch-Groups 2026-06-09-00:00:
Branch-group member integration policy (S11). A task sharing a group branch always
integrates regardless of the global auto-merge setting, because the shared branch is
the group's own integration surface. A non-shared (per-task-derived) member only
integrates automatically when global auto-merge is enabled; otherwise integration is
gated to manual so operators retain control over independent branches.
*/
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

/*
FNXC:Branch-Groups 2026-06-09-00:00:
Branch-group promotion policy (S11). Promoting a group branch to its target requires
BOTH global auto-merge and the group's own auto-merge flag to be enabled. Either one
being disabled gates promotion to manual, so disabling auto-merge at either the global
or group level is sufficient to require human approval before the group lands.
*/
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
