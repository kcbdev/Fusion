import type { Task } from "./types.js";

export type StalePausedReviewCode = "stale-paused-review";

export interface StalePausedReviewSignal {
  code: StalePausedReviewCode;
  reason: string;
  observedAt: string;
  ageMs: number;
  thresholdMs: number;
  pausedReason?: string;
  pausedByAgentId?: string;
}

export interface StalePausedReviewContext {
  now?: number;
  thresholdMs?: number;
}

export const DEFAULT_STALE_PAUSED_REVIEW_THRESHOLD_MS = 24 * 60 * 60_000;

export function getStalePausedReviewSignal(
  task: Pick<Task, "column" | "paused" | "columnMovedAt" | "updatedAt" | "mergeDetails" | "pausedReason" | "pausedByAgentId">,
  context: StalePausedReviewContext = {},
): StalePausedReviewSignal | undefined {
  if (task.column !== "in-review" || task.paused !== true) return undefined;
  if (task.mergeDetails?.mergeConfirmed === true) return undefined;

  const thresholdMs = context.thresholdMs ?? DEFAULT_STALE_PAUSED_REVIEW_THRESHOLD_MS;
  if (!Number.isFinite(thresholdMs) || thresholdMs <= 0) return undefined;

  const now = context.now ?? Date.now();
  const anchor = Date.parse(task.columnMovedAt ?? task.updatedAt);
  if (!Number.isFinite(anchor)) return undefined;

  const ageMs = now - anchor;
  if (ageMs < thresholdMs) return undefined;

  return {
    code: "stale-paused-review",
    reason: "Task has remained paused in review beyond threshold",
    observedAt: new Date(now).toISOString(),
    ageMs,
    thresholdMs,
    pausedReason: task.pausedReason,
    pausedByAgentId: task.pausedByAgentId,
  };
}
