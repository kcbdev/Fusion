import type { Task } from "@fusion/core";

/**
 * Statuses that are NEVER stuck — even past the timeout. `failed`/`stuck-killed`
 * are terminal. The `awaiting-*` family (U14, R21/R20) are INTENTIONAL human
 * waits: a task parked on a structured question (`awaiting-user-input`), a
 * plan-approval hold (`awaiting-approval`), or a planning-interview pause
 * (`planning-awaiting-input`) is blocked on the human by design — surfacing it
 * as "stuck" (and, server-side, auto-moving it) would treat a deliberate wait as
 * a fault. The card surfaces these via their own awaiting-input/awaiting-approval
 * badges instead.
 */
const NON_STUCK_STATUSES = new Set([
  "failed",
  "stuck-killed",
  "awaiting-user-input",
  "awaiting-approval",
  "planning-awaiting-input",
]);

/**
 * Check if a task is stuck based on the project's stuck timeout setting.
 *
 * A task is considered stuck when:
 * - It is in the "in-progress" column
 * - A positive `taskStuckTimeoutMs` value is provided (stuck detection enabled)
 * - Its `updatedAt` timestamp is older than `taskStuckTimeoutMs` milliseconds ago
 *   compared to `dataAsOfMs` (or `Date.now()` if `dataAsOfMs` is not provided)
 *
 * When `taskStuckTimeoutMs` is undefined, null, or 0, stuck detection is
 * disabled and this function always returns false.
 *
 * The optional `dataAsOfMs` parameter represents when the task data was last
 * confirmed fresh by the server. When provided, it is used instead of `Date.now()`
 * for the comparison. This prevents false positives when the tab has been in
 * the background and the task data is stale.
 */
export function isTaskStuck(task: Task, taskStuckTimeoutMs: number | undefined, dataAsOfMs?: number): boolean {
  if (task.column !== "in-progress") {
    return false;
  }

  if (task.status && NON_STUCK_STATUSES.has(task.status)) {
    return false;
  }

  if (!taskStuckTimeoutMs || taskStuckTimeoutMs <= 0) {
    return false;
  }

  const updatedAt = new Date(task.updatedAt).getTime();
  // Use dataAsOfMs if provided, otherwise fall back to current time
  const now = dataAsOfMs ?? Date.now();
  return now - updatedAt > taskStuckTimeoutMs;
}

/**
 * Derive the stuck task count from a list of tasks using the given threshold.
 *
 * Returns 0 when stuck detection is disabled (undefined/0 threshold).
 *
 * The optional `dataAsOfMs` parameter is passed through to `isTaskStuck()` for
 * freshness-aware stuck detection.
 */
export function countStuckTasks(tasks: Task[], taskStuckTimeoutMs: number | undefined, dataAsOfMs?: number): number {
  if (!taskStuckTimeoutMs || taskStuckTimeoutMs <= 0) {
    return 0;
  }

  let count = 0;
  for (const task of tasks) {
    if (isTaskStuck(task, taskStuckTimeoutMs, dataAsOfMs)) {
      count++;
    }
  }
  return count;
}
