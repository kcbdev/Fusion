import type { BoardWorkflowsPayload } from "../api";

const BOARD_WORKFLOWS_CACHE_PREFIX = "fusion:board-workflows:";
const DEFAULT_PROJECT_CACHE_KEY = "default";

function cacheKey(projectId?: string): string {
  return `${BOARD_WORKFLOWS_CACHE_PREFIX}${projectId ?? DEFAULT_PROJECT_CACHE_KEY}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoardWorkflowsPayload(value: unknown): value is BoardWorkflowsPayload {
  if (!isRecord(value)) return false;
  if (typeof value.flagEnabled !== "boolean") return false;
  if (!Array.isArray(value.workflows)) return false;
  if (typeof value.defaultWorkflowId !== "string") return false;
  if (!isRecord(value.taskWorkflowIds)) return false;
  return true;
}

/**
 * FNXC:BoardWorkflows 2026-06-20-08:50:
 * Cache the last successful board-workflows payload per project in sessionStorage so Board and ListView can render the correct workflow-lane layout immediately on remount and never flash the legacy single-lane board before the async revalidation finishes.
 */
export function readBoardWorkflowsCache(projectId?: string): BoardWorkflowsPayload | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.sessionStorage.getItem(cacheKey(projectId));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as unknown;
    return isBoardWorkflowsPayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeBoardWorkflowsCache(projectId: string | undefined, payload: BoardWorkflowsPayload): void {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.setItem(cacheKey(projectId), JSON.stringify(payload));
  } catch {
    // Private-mode/quota failures should never prevent board rendering.
  }
}
