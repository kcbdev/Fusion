import { describe, expect, it } from "vitest";
import type { TaskStore, RunAuditEventInput } from "@fusion/core";
import { createRunAuditor, type DatabaseMutationType, type GitMutationType } from "../run-audit.js";

class AuditStoreStub {
  events: RunAuditEventInput[] = [];
  recordRunAuditEvent(event: RunAuditEventInput): void {
    this.events.push(event);
  }
}

describe("run-audit provisioning mutation types", () => {
  it("accepts provisioning mutation types and records them", async () => {
    const store = new AuditStoreStub();
    const auditor = createRunAuditor(store as unknown as TaskStore, { runId: "r1", agentId: "a1", taskId: "FN-1" });

    const types: DatabaseMutationType[] = [
      "agent:create:requested",
      "agent:create:approved",
      "agent:create:denied",
      "agent:delete:requested",
      "agent:delete:approved",
      "agent:delete:denied",
    ];

    for (const type of types) {
      await auditor.database({ type, target: "agent-x" });
    }

    expect(store.events.map((event) => event.mutationType)).toEqual(types);
  });

  it("accepts integration-worktree merge git mutation types", async () => {
    const store = new AuditStoreStub();
    const auditor = createRunAuditor(store as unknown as TaskStore, { runId: "r1", agentId: "a1", taskId: "FN-1" });

    await auditor.git({
      type: "merge:integration-worktree-state",
      target: "main",
      metadata: {
        taskId: "FN-1",
        integrationBranch: "main",
        integrationMode: "reuse-task-worktree",
        integrationRootDir: "/repo",
        taskWorktreePath: "/repo/.worktrees/fn-1",
        userCheckout: {
          worktreePath: "/repo",
          dirty: true,
          untrackedCount: 1,
          dirtyPathSample: ["README.md"],
        },
        dirtyFingerprint: "abc123",
      },
    });
    await auditor.git({
      type: "merge:cwd-integration-fallback-refused",
      target: "main",
      metadata: {
        taskId: "FN-1",
        integrationBranch: "main",
        refusedGate: "working-tree-dirty",
        refusedReason: "worktree has local changes",
        requestedMode: "reuse-task-worktree",
        taskWorktreePath: "/repo/.worktrees/fn-1",
        parkOutcome: "in-review-failed",
      },
    });
    await auditor.git({
      type: "merge:integration-ref-advance",
      target: "main",
      metadata: {
        taskId: "FN-1",
        integrationBranch: "main",
        refName: "refs/heads/main",
        fromSha: "1111111",
        toSha: "2222222",
        advanceMode: "fast-forward",
        succeeded: true,
      },
    });

    expect(store.events).toHaveLength(3);
    expect(store.events.map((event) => event.domain)).toEqual(["git", "git", "git"]);
    expect(store.events.map((event) => event.mutationType)).toEqual([
      "merge:integration-worktree-state",
      "merge:cwd-integration-fallback-refused",
      "merge:integration-ref-advance",
    ]);
  });

  it("accepts smart-pull git mutation types", async () => {
    const store = new AuditStoreStub();
    const auditor = createRunAuditor(store as unknown as TaskStore, { runId: "r1", agentId: "a1", taskId: "FN-5358" });

    const types: GitMutationType[] = ["pull:fast-forward", "stash:pop-conflict"];
    for (const type of types) {
      await auditor.git({ type, target: "feature/worktree", metadata: { taskId: "FN-5358" } });
    }

    expect(store.events.map((event) => event.mutationType)).toEqual(types);
  });

  it("records merge:scope:auto-widen git events", async () => {
    const store = new AuditStoreStub();
    const auditor = createRunAuditor(store as unknown as TaskStore, { runId: "r1", agentId: "a1", taskId: "FN-5226" });

    await auditor.git({
      type: "merge:scope:auto-widen",
      target: "fusion/fn-5226",
      metadata: {
        taskId: "FN-5226",
        file: "AGENTS.md",
        attribution: "subject-prefix",
        commits: ["abc123"],
      },
    });

    expect(store.events).toHaveLength(1);
    expect(store.events[0]?.mutationType).toBe("merge:scope:auto-widen");
    expect(store.events[0]?.metadata).toEqual({
      taskId: "FN-5226",
      file: "AGENTS.md",
      attribution: "subject-prefix",
      commits: ["abc123"],
    });
  });
});
