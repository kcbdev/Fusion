import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Agent, AgentHeartbeatRun } from "@fusion/core";
import { HeartbeatMonitor } from "../agent-heartbeat.js";
import * as worktreeAcquisition from "../worktree-acquisition.js";
import * as piModule from "../pi.js";

describe("heartbeat worktree cwd", () => {
  let store: any;
  let taskStore: any;
  const agent: Agent = { id: "a1", name: "A", role: "executor", state: "active", taskId: "FN-1", createdAt: "", updatedAt: "", metadata: {} } as any;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(piModule, "createFnAgent").mockResolvedValue({ session: { prompt: vi.fn(), dispose: vi.fn() } } as any);
    vi.spyOn(worktreeAcquisition, "acquireTaskWorktree").mockResolvedValue({ worktreePath: "/tmp/wt", branch: "fusion/fn-1", source: "existing", hydrated: false, isResume: true });

    const run: AgentHeartbeatRun = { id: "r1", agentId: "a1", status: "active", startedAt: new Date().toISOString(), endedAt: null } as any;
    store = {
      startHeartbeatRun: vi.fn().mockResolvedValue(run),
      saveRun: vi.fn(),
      getRunDetail: vi.fn().mockResolvedValue(run),
      getAgent: vi.fn().mockResolvedValue(agent),
      updateAgentState: vi.fn(),
      updateAgent: vi.fn(),
      endHeartbeatRun: vi.fn(),
      assignTask: vi.fn(),
      getBudgetStatus: vi.fn().mockResolvedValue({ isOverBudget: false, isOverThreshold: false, usagePercent: 0 }),
      getCachedAgent: vi.fn().mockReturnValue(null),
      getLastBlockedState: vi.fn().mockResolvedValue(null),
      setLastBlockedState: vi.fn(),
      clearLastBlockedState: vi.fn(),
      appendRunLog: vi.fn(),
      getAgentsByReportsTo: vi.fn().mockResolvedValue([]),
      recordHeartbeat: vi.fn(),
    };
    taskStore = {
      getSettings: vi.fn().mockResolvedValue({}),
      getTask: vi.fn().mockResolvedValue({ id: "FN-1", title: "t", description: "d", column: "todo", dependencies: [], steps: [], log: [] }),
      moveTask: vi.fn(),
      appendAgentLog: vi.fn(),
      listTasks: vi.fn().mockResolvedValue([]),
      selectNextTaskForAgent: vi.fn().mockResolvedValue(null),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses acquired worktree cwd for task-scoped runs", async () => {
    const monitor = new HeartbeatMonitor({ store, taskStore, rootDir: "/repo" });
    await monitor.executeHeartbeat({ agentId: "a1", source: "on_demand" });
    expect(worktreeAcquisition.acquireTaskWorktree).toHaveBeenCalled();
    expect(piModule.createFnAgent).toHaveBeenCalledWith(expect.objectContaining({ cwd: "/tmp/wt" }));
  });

  it("uses rootDir for no-task runs", async () => {
    store.getAgent.mockResolvedValue({ ...agent, taskId: undefined, soul: "x" });
    const monitor = new HeartbeatMonitor({ store, taskStore, rootDir: "/repo" });
    await monitor.executeHeartbeat({ agentId: "a1", source: "on_demand" });
    expect(worktreeAcquisition.acquireTaskWorktree).not.toHaveBeenCalled();
    expect(piModule.createFnAgent).toHaveBeenCalledWith(expect.objectContaining({ cwd: "/repo" }));
  });

  it("completes with worktree_acquisition_failed when helper throws", async () => {
    vi.spyOn(worktreeAcquisition, "acquireTaskWorktree").mockRejectedValueOnce(new Error("nope"));
    const monitor = new HeartbeatMonitor({ store, taskStore, rootDir: "/repo" });
    await monitor.executeHeartbeat({ agentId: "a1", source: "on_demand" });
    expect(piModule.createFnAgent).not.toHaveBeenCalled();
    expect(taskStore.moveTask).toHaveBeenCalledWith("FN-1", "todo", { preserveProgress: true });
  });
});
