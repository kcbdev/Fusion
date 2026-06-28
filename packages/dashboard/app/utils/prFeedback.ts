import type { PrInfo, Task } from "@fusion/core";

export function getTaskPrimaryPrInfo(task: Pick<Task, "prInfo" | "prInfos">): PrInfo | undefined {
  return task.prInfos?.[0] ?? task.prInfo;
}

/*
FNXC:TaskReview 2026-06-28-00:00:
The Address PR feedback affordance must render identically on the task card and Review tab. Gate it on one shared predicate so a linked primary PR with comments or CHANGES_REQUESTED is actionable, while no-PR and no-feedback states render no empty button shell.

FNXC:TaskReview 2026-06-28-16:39:
The button promises an AI session starts, so it must only render for task states the lifecycle route can actually start or wake. Restrict the launch affordance to in-review and in-progress tasks rather than letting terminal/todo cards add steering comments without active work.
*/
export function hasActionablePrFeedback(task: Pick<Task, "prInfo" | "prInfos">): boolean {
  const prInfo = getTaskPrimaryPrInfo(task);
  if (!prInfo) return false;
  return (prInfo.commentCount ?? 0) > 0 || prInfo.lastReviewDecision === "CHANGES_REQUESTED";
}

export function canStartPrFeedbackAddressing(task: Pick<Task, "column" | "prInfo" | "prInfos">): boolean {
  return (task.column === "in-review" || task.column === "in-progress") && hasActionablePrFeedback(task);
}
