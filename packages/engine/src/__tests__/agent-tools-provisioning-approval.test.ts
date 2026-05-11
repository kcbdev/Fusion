import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent, AgentStore, ApprovalRequestStore, ProjectSettings } from "@fusion/core";
import { createAgentCreateTool, createAgentDeleteTool, executeApprovedAgentProvisioning } from "../agent-tools.js";

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  const now = new Date().toISOString();
  return {
    id: "agent-caller",
    name: "Caller",
    role: "executor",
    reportsTo: "agent-root",
    state: "idle",
    createdAt: now,
    updatedAt: now,
    metadata: {},
    ...overrides,
  };
}

const withProvisioning = (agentProvisioning: NonNullable<ProjectSettings["agentProvisioning"]>): ProjectSettings => ({
  maxConcurrent: 2,
  maxWorktrees: 2,
  pollIntervalMs: 5000,
  groupOverlappingFiles: true,
  autoMerge: false,
  autoResolveConflicts: true,
  agentProvisioning,
});

describe("agent provisioning approval tools", () => {
  let agentStore: AgentStore;
  let approvalRequestStore: ApprovalRequestStore;

  beforeEach(() => {
    const caller = makeAgent({ id: "agent-caller", role: "executor" });
    const target = makeAgent({ id: "agent-target", reportsTo: "agent-caller" });
    agentStore = {
      getAgent: vi.fn(async (id: string) => (id === caller.id ? caller : id === target.id ? target : null)),
      createAgent: vi.fn(async (input: any) => makeAgent({ id: "agent-created", name: input.name, role: input.role })),
      deleteAgent: vi.fn(async () => undefined),
    } as unknown as AgentStore;

    approvalRequestStore = {
      create: vi.fn((input: any) => ({
        id: "APR-1",
        status: "pending",
        requester: input.requester,
        targetAction: input.targetAction,
      })),
    } as unknown as ApprovalRequestStore;
  });

  it("creates pending approval for untrusted create and includes approvalDedupeKey", async () => {
    const tool = createAgentCreateTool(agentStore, "agent-caller", {
      approvalRequestStore,
      settingsProvider: async () => withProvisioning({ approvalMode: "trusted-only" }),
    });

    const result = await tool.execute("s", { name: "New Agent", role: "executor" } as any, undefined as any, undefined as any, undefined as any);

    expect((result.details as any).outcome).toBe("pending_approval");
    expect(approvalRequestStore.create).toHaveBeenCalledTimes(1);
    const context = vi.mocked(approvalRequestStore.create).mock.calls[0]?.[0]?.targetAction?.context as any;
    expect(context.tool).toBe("fn_agent_create");
    expect(typeof context.approvalDedupeKey).toBe("string");
    expect(context.approvalDedupeKey.length).toBeGreaterThan(0);
    expect(agentStore.createAgent).not.toHaveBeenCalled();
  });

  it("auto-approves trusted role create", async () => {
    vi.mocked(agentStore.getAgent).mockResolvedValueOnce(makeAgent({ id: "agent-caller", role: "ceo" as any }));
    const tool = createAgentCreateTool(agentStore, "agent-caller", {
      approvalRequestStore,
      settingsProvider: async () => withProvisioning({ approvalMode: "trusted-only", trustedRoles: ["ceo"] }),
    });

    const result = await tool.execute("s", { name: "New Agent", role: "executor" } as any, undefined as any, undefined as any, undefined as any);
    expect((result.details as any).outcome).toBe("created");
    expect(agentStore.createAgent).toHaveBeenCalledTimes(1);
  });

  it("delete requires approval by default and includes approvalDedupeKey", async () => {
    const tool = createAgentDeleteTool(agentStore, "agent-caller", {
      approvalRequestStore,
      settingsProvider: async () => withProvisioning({ approvalMode: "trusted-only", trustedAgentIds: ["agent-caller"] }),
    });

    const result = await tool.execute("s", { agent_id: "agent-target" } as any, undefined as any, undefined as any, undefined as any);

    expect((result.details as any).outcome).toBe("pending_approval");
    const context = vi.mocked(approvalRequestStore.create).mock.calls[0]?.[0]?.targetAction?.context as any;
    expect(context.tool).toBe("fn_agent_delete");
    expect(typeof context.approvalDedupeKey).toBe("string");
    expect(agentStore.deleteAgent).not.toHaveBeenCalled();
  });

  it("allows trusted delete when alwaysApproveDelete is false", async () => {
    const tool = createAgentDeleteTool(agentStore, "agent-caller", {
      approvalRequestStore,
      settingsProvider: async () => withProvisioning({
        approvalMode: "trusted-only",
        trustedAgentIds: ["agent-caller"],
        alwaysApproveDelete: false,
      }),
    });

    const result = await tool.execute("s", { agent_id: "agent-target" } as any, undefined as any, undefined as any, undefined as any);
    expect((result.details as any).outcome).toBe("deleted");
    expect(agentStore.deleteAgent).toHaveBeenCalledWith("agent-target", { force: false, reassignTo: undefined });
  });

  it("executeApprovedAgentProvisioning creates/deletes from request payload", async () => {
    const created = await executeApprovedAgentProvisioning({
      id: "APR-C",
      status: "approved",
      targetAction: {
        category: "agent_provisioning",
        action: "create",
        summary: "",
        resourceType: "agent",
        resourceId: "",
        context: { tool: "fn_agent_create", params: { name: "X", role: "executor" } },
      },
    } as any, { agentStore });
    expect((created as Agent).name).toBe("X");

    const deleted = await executeApprovedAgentProvisioning({
      id: "APR-D",
      status: "approved",
      targetAction: {
        category: "agent_provisioning",
        action: "delete",
        summary: "",
        resourceType: "agent",
        resourceId: "agent-target",
        context: { tool: "fn_agent_delete", params: { agent_id: "agent-target" } },
      },
    } as any, { agentStore });
    expect(deleted).toEqual({ deletedId: "agent-target" });
  });
});
