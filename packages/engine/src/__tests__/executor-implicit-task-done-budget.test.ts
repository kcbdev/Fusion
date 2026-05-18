import { beforeEach, describe, expect, it, vi } from "vitest";
import "./executor-test-helpers.js";
import { TaskExecutor } from "../executor.js";
import { executorLog } from "../logger.js";
import { createMockStore, mockedCreateFnAgent, resetExecutorMocks } from "./executor-test-helpers.js";

function refusal() {
  return {
    ok: false as const,
    refusalClass: "pending-code-review-revise" as const,
    reason: "Step 1 has pending REVISE",
    message: "fn_task_done refused (pending-code-review-revise): Step 1 has pending REVISE",
  };
}

function task(retryCount: number) {
  return {
    id: "FN-4946-B",
    title: "Budget",
    description: "",
    column: "in-progress",
    worktree: "/repo/.worktrees/swift-falcon",
    branch: "fusion/fn-4946-b",
    baseCommitSha: "abc123",
    taskDoneRetryCount: retryCount,
    dependencies: [],
    steps: [{ name: "Step 1", status: "in-progress" as const }],
    currentStep: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as any;
}

describe("FN-4946 implicit refusal budget handling", () => {
  beforeEach(() => {
    resetExecutorMocks();
  });

  it("requeues to todo under budget", async () => {
    const store = createMockStore();
    const executor = new TaskExecutor(store as any, "/repo");

    await (executor as any).handleImplicitTaskDoneRefusal(task(2), "/repo/.worktrees/swift-falcon", refusal());

    expect(store.updateTask).toHaveBeenCalledWith("FN-4946-B", expect.objectContaining({ taskDoneRetryCount: 3, status: "failed" }));
    expect(store.moveTask).toHaveBeenCalledWith("FN-4946-B", "todo", { preserveProgress: true });
    expect(executorLog.error).toHaveBeenCalledWith(expect.stringContaining("(implicit completion)"));
  });

  it("escalates to in-review at budget limit", async () => {
    const store = createMockStore();
    const executor = new TaskExecutor(store as any, "/repo");
    const persistSpy = vi.spyOn(executor as any, "persistTokenUsage").mockResolvedValue(undefined);

    await (executor as any).handleImplicitTaskDoneRefusal(task(3), "/repo/.worktrees/swift-falcon", refusal());

    expect(store.updateTask).toHaveBeenCalledWith("FN-4946-B", expect.objectContaining({ status: "failed" }));
    expect(store.moveTask).toHaveBeenCalledWith("FN-4946-B", "in-review");
    expect(persistSpy).toHaveBeenCalledWith("FN-4946-B");
  });

  it("shares retry budget with explicit fn_task_done refusals", async () => {
    const store = createMockStore();
    let currentTask: any = { ...task(2), id: "FN-4946-B2", steps: [{ name: "Step 1", status: "in-progress" }] };
    let doneTool: any;

    store.getTask.mockImplementation(async () => ({ ...currentTask, steps: currentTask.steps.map((s: any) => ({ ...s })) }));
    store.updateTask.mockImplementation(async (_id: string, patch: any) => {
      currentTask = { ...currentTask, ...patch };
    });

    mockedCreateFnAgent.mockImplementation(async ({ customTools }: any) => {
      doneTool = customTools.find((t: any) => t.name === "fn_task_done");
      return { session: { prompt: vi.fn().mockResolvedValue(undefined), dispose: vi.fn(), subscribe: vi.fn(), on: vi.fn(), state: {} } } as any;
    });

    const executor = new TaskExecutor(store as any, "/repo");
    await executor.execute(currentTask);

    await doneTool.execute("d1", { summary: "I am not done yet." });
    await (executor as any).handleImplicitTaskDoneRefusal({ ...currentTask, id: "FN-4946-B2" }, "/repo/.worktrees/swift-falcon", refusal());

    expect(store.moveTask).toHaveBeenCalledWith("FN-4946-B2", "in-review");
  });

  it("resets taskDoneRetryCount after later clean completion", async () => {
    const store = createMockStore();
    let currentTask: any = { ...task(1), id: "FN-4946-B3", steps: [{ name: "Step 1", status: "in-progress" }], executionMode: "fast" };
    store.getTask.mockImplementation(async () => ({ ...currentTask, steps: currentTask.steps.map((s: any) => ({ ...s })) }));
    store.updateTask.mockImplementation(async (_id: string, patch: any) => {
      currentTask = { ...currentTask, ...patch };
    });

    mockedCreateFnAgent.mockImplementation(async ({ customTools }: any) => {
      const doneTool = customTools.find((t: any) => t.name === "fn_task_done");
      return {
        session: {
          prompt: vi.fn().mockImplementation(async () => {
            await doneTool.execute("done", { summary: "complete" });
          }),
          dispose: vi.fn(),
          subscribe: vi.fn(),
          on: vi.fn(),
          state: {},
        },
      } as any;
    });

    const executor = new TaskExecutor(store as any, "/repo");
    await executor.execute(currentTask);

    expect(store.moveTask).toHaveBeenCalledWith("FN-4946-B3", "in-review");
    const retryBumpCalls = store.updateTask.mock.calls.filter(([, patch]: [string, Record<string, unknown>]) => typeof patch.taskDoneRetryCount === "number" && patch.taskDoneRetryCount > 1);
    expect(retryBumpCalls).toHaveLength(0);
  });
});
