import { describe, expect, it, vi } from "vitest";
import type { RunAuditEventInput, TaskStore } from "@fusion/core";
import { createRunAuditor } from "../run-audit.js";
import {
  emitGoalAnchoringAudit,
  emitGoalRetrievalAudit,
  GOAL_INJECTION_APPLIED,
  GOAL_INJECTION_SKIPPED,
  GOAL_RETRIEVAL_INVOKED,
} from "../goal-anchoring-audit.js";

describe("goal anchoring audit helpers", () => {
  it("emits applied injection audit", async () => {
    const database = vi.fn(async () => {});
    await emitGoalAnchoringAudit({ database } as any, {
      lane: "heartbeat",
      taskId: "FN-1",
      goalsInjected: 3,
    });
    expect(database).toHaveBeenCalledWith(expect.objectContaining({
      type: GOAL_INJECTION_APPLIED,
      target: "FN-1",
      metadata: expect.objectContaining({ lane: "heartbeat", count: 3 }),
    }));
  });

  it("emits skipped injection audit with reason and default target", async () => {
    const database = vi.fn(async () => {});
    await emitGoalAnchoringAudit({ database } as any, {
      lane: "executor",
      goalsInjected: 0,
      reason: "no-active-goals",
    });
    expect(database).toHaveBeenCalledWith(expect.objectContaining({
      type: GOAL_INJECTION_SKIPPED,
      target: "goals",
      metadata: expect.objectContaining({ reason: "no-active-goals", count: 0 }),
    }));
  });

  it("includes truncated metadata when present", async () => {
    const database = vi.fn(async () => {});
    await emitGoalAnchoringAudit({ database } as any, {
      lane: "heartbeat",
      goalsInjected: 1,
      truncated: true,
    });
    expect(database).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ truncated: true }),
    }));
  });

  it("emits retrieval audit when run context exists", () => {
    const recordRunAuditEvent = vi.fn();
    const store = { recordRunAuditEvent } as unknown as TaskStore;
    emitGoalRetrievalAudit(store, { runId: "r1", agentId: "a1", taskId: "FN-1" }, { toolName: "fn_goal_list", resultCount: 2 });
    expect(recordRunAuditEvent).toHaveBeenCalledTimes(1);
    expect(recordRunAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      domain: "database",
      mutationType: GOAL_RETRIEVAL_INVOKED,
      target: "goals",
      metadata: expect.objectContaining({ toolName: "fn_goal_list", count: 2, notFound: false }),
    }));
  });

  it("skips retrieval audit when runId or agentId is missing", () => {
    const recordRunAuditEvent = vi.fn();
    const store = { recordRunAuditEvent } as unknown as TaskStore;
    emitGoalRetrievalAudit(store, { agentId: "a1" }, { toolName: "fn_goal_list", resultCount: 2 });
    emitGoalRetrievalAudit(store, { runId: "r1" }, { toolName: "fn_goal_list", resultCount: 2 });
    expect(recordRunAuditEvent).not.toHaveBeenCalled();
  });

  it("swallows retrieval audit failures and warns once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = { recordRunAuditEvent: vi.fn(() => { throw new Error("boom"); }) } as unknown as TaskStore;
    expect(() => emitGoalRetrievalAudit(store, { runId: "r1", agentId: "a1" }, { toolName: "fn_goal_show", resultCount: 0, goalId: "G-1", notFound: true })).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("persists heartbeat-style events through createRunAuditor", async () => {
    const events: RunAuditEventInput[] = [];
    const store = { recordRunAuditEvent: vi.fn((input: RunAuditEventInput) => events.push(input)) } as unknown as TaskStore;
    const auditor = createRunAuditor(store, { runId: "run-1", agentId: "agent-1", taskId: "FN-9", phase: "heartbeat" });

    await emitGoalAnchoringAudit(auditor, { lane: "heartbeat", taskId: "FN-9", goalsInjected: 2 });
    await emitGoalAnchoringAudit(auditor, { lane: "heartbeat", taskId: "FN-9", goalsInjected: 0, reason: "no-active-goals" });

    const goalEvents = events.filter((event) => String(event.mutationType).startsWith("goal:"));
    expect(goalEvents).toHaveLength(2);
    expect(goalEvents[0]).toMatchObject({ mutationType: GOAL_INJECTION_APPLIED, metadata: expect.objectContaining({ count: 2, lane: "heartbeat" }) });
    expect(goalEvents[1]).toMatchObject({ mutationType: GOAL_INJECTION_SKIPPED, metadata: expect.objectContaining({ count: 0, reason: "no-active-goals" }) });
  });
});
