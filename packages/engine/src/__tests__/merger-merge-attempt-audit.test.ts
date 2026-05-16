import { describe, expect, it, vi } from "vitest";
import { createRunAuditor } from "../run-audit.js";
import { emitMergeAttemptAuditEvent } from "../merger.js";
import type { RunAuditEventInput, TaskStore } from "@fusion/core";

describe("merge attempt run_audit emission (FN-4809)", () => {
  it("emits git merge:start with merge-attempt phase consumed by reliability metric", async () => {
    const recordRunAuditEvent = vi.fn(async (_input: RunAuditEventInput) => {});
    const store = {
      recordRunAuditEvent,
    } as unknown as TaskStore;

    const audit = createRunAuditor(store, {
      runId: "run-4809",
      agentId: "agent-4809",
      taskId: "FN-4809",
      phase: "merge",
    });

    await emitMergeAttemptAuditEvent({
      audit,
      branch: "fusion/FN-4809",
      attemptNum: 1,
      mergeConflictStrategy: "smart-prefer-main",
      attemptLabel: "Attempt 1: AI merge",
      taskId: "FN-4809",
    });

    expect(recordRunAuditEvent).toHaveBeenCalledTimes(1);
    const event = recordRunAuditEvent.mock.calls[0][0];
    expect(event.domain).toBe("git");
    expect(event.mutationType).toBe("merge:start");
    expect(event.taskId).toBe("FN-4809");
    expect(event.metadata?.phase).toBe("merge-attempt-1");
    expect(event.metadata?.phase).toMatch(/^merge-attempt-/);
  });

  it("swallows audit-store failures so merge attempts are not blocked", async () => {
    const store = {
      recordRunAuditEvent: vi.fn(async () => {
        throw new Error("db unavailable");
      }),
    } as unknown as TaskStore;

    const audit = createRunAuditor(store, {
      runId: "run-4809-err",
      agentId: "agent-4809",
      taskId: "FN-4809",
      phase: "merge",
    });

    await expect(
      emitMergeAttemptAuditEvent({
        audit,
        branch: "fusion/FN-4809",
        attemptNum: 2,
        mergeConflictStrategy: "smart-prefer-main",
        attemptLabel: "Attempt 2",
        taskId: "FN-4809",
      }),
    ).resolves.toBeUndefined();
  });
});
