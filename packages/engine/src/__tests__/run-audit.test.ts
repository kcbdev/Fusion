import { describe, expect, it } from "vitest";
import type { TaskStore, RunAuditEventInput } from "@fusion/core";
import { createRunAuditor, type DatabaseMutationType } from "../run-audit.js";

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
});
