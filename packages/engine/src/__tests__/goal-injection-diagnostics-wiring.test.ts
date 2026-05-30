import { describe, expect, it, vi } from "vitest";
import type { Goal } from "@fusion/core";
import { emitGoalInjectionDiagnostic, resolveGoalContextForDiagnostics } from "../goal-injection-diagnostics.js";

function goal(id: string, title: string, createdAt: string): Goal {
  return {
    id,
    title,
    description: undefined,
    status: "active",
    createdAt,
    updatedAt: createdAt,
  };
}

describe("goal injection diagnostics wiring seam", () => {
  it("emits applied audit metadata for positive injection", async () => {
    const goals = [goal("G-1", "one", "2026-01-01T00:00:00.000Z"), goal("G-2", "two", "2026-01-02T00:00:00.000Z")];
    const recordRunAuditEvent = vi.fn().mockResolvedValue(undefined);
    const store = { logEntry: vi.fn().mockResolvedValue(undefined), recordRunAuditEvent } as any;

    const resolution = resolveGoalContextForDiagnostics({ listActiveGoals: () => goals });
    await emitGoalInjectionDiagnostic({
      lane: "executor",
      ...resolution.classification,
      runId: "exec-run",
      agentId: "agent-1",
      taskId: "FN-1",
      store,
      runContext: { runId: "exec-run", agentId: "agent-1", taskId: "FN-1", phase: "execute" },
    });

    expect(recordRunAuditEvent).toHaveBeenCalledTimes(1);
    const event = recordRunAuditEvent.mock.calls[0][0];
    expect(event.mutationType).toBe("prompt:goal-injection");
    expect(event.metadata).toMatchObject({ outcome: "applied", goalCount: 2, goalIds: ["G-1", "G-2"] });
  });

  it("emits no-goals audit metadata when active goals are empty", async () => {
    const recordRunAuditEvent = vi.fn().mockResolvedValue(undefined);
    const store = { logEntry: vi.fn().mockResolvedValue(undefined), recordRunAuditEvent } as any;

    const resolution = resolveGoalContextForDiagnostics({ listActiveGoals: () => [] });
    await emitGoalInjectionDiagnostic({
      lane: "executor",
      ...resolution.classification,
      runId: "exec-run",
      agentId: "agent-1",
      taskId: "FN-1",
      store,
      runContext: { runId: "exec-run", agentId: "agent-1", taskId: "FN-1", phase: "execute" },
    });

    expect(recordRunAuditEvent).toHaveBeenCalledTimes(1);
    expect(recordRunAuditEvent.mock.calls[0][0].metadata).toMatchObject({ outcome: "no-goals", goalCount: 0, goalIds: [] });
  });

  it("classifies list failure and keeps prompt construction alive", async () => {
    const recordRunAuditEvent = vi.fn().mockResolvedValue(undefined);
    const store = { logEntry: vi.fn().mockResolvedValue(undefined), recordRunAuditEvent } as any;

    const resolution = resolveGoalContextForDiagnostics({
      listActiveGoals: () => {
        throw new TypeError("boom");
      },
    });

    await expect(
      emitGoalInjectionDiagnostic({
        lane: "executor",
        ...resolution.classification,
        runId: "exec-run",
        agentId: "agent-1",
        taskId: "FN-1",
        store,
        runContext: { runId: "exec-run", agentId: "agent-1", taskId: "FN-1", phase: "execute" },
      }),
    ).resolves.toBeTruthy();
    expect(recordRunAuditEvent).toHaveBeenCalledTimes(1);
    expect(recordRunAuditEvent.mock.calls[0][0].metadata).toMatchObject({
      outcome: "disabled-or-failed",
      reason: "list-failed",
      errorClass: "TypeError",
    });
    expect(resolution.goalContext).toBe("");
  });
});
