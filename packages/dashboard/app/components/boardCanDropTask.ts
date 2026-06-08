import type { Task } from "@fusion/core";
import type { BoardWorkflowsPayload } from "../api";

export interface BoardCanDropTaskInput {
  boardWorkflows: BoardWorkflowsPayload | null | undefined;
  tasks: Task[];
  maxConcurrent: number;
  taskId: string;
  targetColumnId: string;
  laneWorkflowId: string;
}

/**
 * Canonical Board drag pre-check (R17). Deterministic rejections return a stable
 * i18n message key; `null` means the pre-check allows the drop or cannot decide.
 */
export function getBoardCanDropTaskRejection({
  boardWorkflows,
  tasks,
  maxConcurrent,
  taskId,
  targetColumnId,
  laneWorkflowId,
}: BoardCanDropTaskInput): string | null {
  if (!boardWorkflows) return null;

  const sourceTask = tasks.find((task) => task.id === taskId);
  if (!sourceTask) return null;

  const sourceWorkflowId = boardWorkflows.taskWorkflowIds[taskId] ?? boardWorkflows.defaultWorkflowId;
  // Cross-lane drag never switches workflows (R17).
  if (sourceWorkflowId !== laneWorkflowId) {
    return "board.rejection.workflowMismatch";
  }

  const workflow = boardWorkflows.workflows.find((candidate) => candidate.id === laneWorkflowId);
  if (!workflow) return null;

  const targetColumn = workflow.columns.find((column) => column.id === targetColumnId);
  if (!targetColumn) return "board.rejection.unknownColumn";

  // Capacity pre-check: a wip-flagged column that is already full rejects.
  if (targetColumn.flags.countsTowardWip) {
    const occupants = tasks.filter(
      (task) => task.column === targetColumnId
        && (boardWorkflows.taskWorkflowIds[task.id] ?? boardWorkflows.defaultWorkflowId) === laneWorkflowId,
    ).length;
    // The default workflow's in-progress limit is maxConcurrent; custom limits
    // are enforced authoritatively server-side (the 409 fallback still snaps back).
    if (Number.isFinite(maxConcurrent) && maxConcurrent > 0 && sourceTask.column !== targetColumnId && occupants >= maxConcurrent) {
      return "board.rejection.capacityExhausted";
    }
  }

  return null;
}
