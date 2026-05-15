import { describe, expect, it } from "vitest";
import { DEFAULT_STALE_PAUSED_REVIEW_THRESHOLD_MS, getStalePausedReviewSignal } from "../stale-paused-review.js";

const NOW = Date.parse("2026-05-14T12:00:00.000Z");

const baseTask = {
  column: "in-review" as const,
  paused: true,
  columnMovedAt: new Date(NOW - DEFAULT_STALE_PAUSED_REVIEW_THRESHOLD_MS).toISOString(),
  updatedAt: new Date(NOW - DEFAULT_STALE_PAUSED_REVIEW_THRESHOLD_MS).toISOString(),
  mergeDetails: {},
  pausedReason: "manual-hold",
  pausedByAgentId: "agent-1",
};

describe("getStalePausedReviewSignal", () => {
  it("returns undefined under threshold", () => {
    const signal = getStalePausedReviewSignal(
      { ...baseTask, columnMovedAt: new Date(NOW - DEFAULT_STALE_PAUSED_REVIEW_THRESHOLD_MS + 1).toISOString() },
      { now: NOW },
    );
    expect(signal).toBeUndefined();
  });

  it("returns signal at threshold with pause metadata", () => {
    const signal = getStalePausedReviewSignal({ ...baseTask }, { now: NOW });
    expect(signal?.code).toBe("stale-paused-review");
    expect(signal?.ageMs).toBe(DEFAULT_STALE_PAUSED_REVIEW_THRESHOLD_MS);
    expect(signal?.thresholdMs).toBe(DEFAULT_STALE_PAUSED_REVIEW_THRESHOLD_MS);
    expect(signal?.pausedReason).toBe("manual-hold");
  });

  it("returns undefined for non-paused in-review", () => {
    expect(getStalePausedReviewSignal({ ...baseTask, paused: false }, { now: NOW })).toBeUndefined();
  });

  it("returns undefined for paused task outside in-review", () => {
    expect(getStalePausedReviewSignal({ ...baseTask, column: "todo" }, { now: NOW })).toBeUndefined();
  });

  it("returns undefined for merge-confirmed task", () => {
    expect(getStalePausedReviewSignal({ ...baseTask, mergeDetails: { mergeConfirmed: true } }, { now: NOW })).toBeUndefined();
  });

  it("falls back to updatedAt when columnMovedAt missing", () => {
    const signal = getStalePausedReviewSignal({
      ...baseTask,
      columnMovedAt: undefined,
      updatedAt: new Date(NOW - DEFAULT_STALE_PAUSED_REVIEW_THRESHOLD_MS - 1_000).toISOString(),
    }, { now: NOW });
    expect(signal?.ageMs).toBe(DEFAULT_STALE_PAUSED_REVIEW_THRESHOLD_MS + 1_000);
  });
});
