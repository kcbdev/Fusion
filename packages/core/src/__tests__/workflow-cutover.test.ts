import { describe, expect, it } from "vitest";

import { evaluateInterpreterCutoverReadiness } from "../workflow-cutover.js";

describe("workflow interpreter authoritative cutover readiness", () => {
  it("is ready when the cutover flag, dual-observe, and clean parity evidence are present", () => {
    const result = evaluateInterpreterCutoverReadiness({
      authoritativeFlagEnabled: true,
      dualObserveEnabled: true,
      paritySummary: { observed: 5, drift: 0, recentDrift: [] },
      minimumObservedRuns: 3,
    });

    expect(result).toEqual({ ready: true, reasons: [] });
  });

  it("enumerates every failed criterion deterministically", () => {
    const result = evaluateInterpreterCutoverReadiness({
      authoritativeFlagEnabled: false,
      dualObserveEnabled: false,
      paritySummary: null,
    });

    expect(result.ready).toBe(false);
    expect(result.reasons).toEqual([
      "experimentalFeatures.workflowInterpreterAuthoritative is disabled",
      "experimentalFeatures.workflowInterpreterDualObserve is disabled",
      "workflow parity summary unavailable",
    ]);
  });

  it("blocks when parity drift is present in the summary or unresolved drift reports", () => {
    const result = evaluateInterpreterCutoverReadiness({
      authoritativeFlagEnabled: true,
      dualObserveEnabled: true,
      paritySummary: {
        observed: 8,
        drift: 2,
        recentDrift: [
          { taskId: "FN-1", timestamp: "2026-06-01T00:00:00.000Z", diffs: [] },
        ],
      },
      unresolvedDriftReports: [
        { agree: false, diffs: [{ field: "terminalColumn", legacy: "done", interpreter: "in-review", category: "lifecycle", severity: "error" }] },
      ],
    });

    expect(result.ready).toBe(false);
    expect(result.reasons).toEqual([
      "workflow parity drift above zero (2 drift events)",
      "workflow parity has unresolved drift reports (1)",
    ]);
  });

  it("normalizes minimum observed runs to at least one", () => {
    const result = evaluateInterpreterCutoverReadiness({
      authoritativeFlagEnabled: true,
      dualObserveEnabled: true,
      paritySummary: { observed: 0, drift: 0, recentDrift: [] },
      minimumObservedRuns: 0,
    });

    expect(result.ready).toBe(false);
    expect(result.reasons).toEqual([
      "workflow parity observation window too small (0/1 observed)",
    ]);
  });
});
