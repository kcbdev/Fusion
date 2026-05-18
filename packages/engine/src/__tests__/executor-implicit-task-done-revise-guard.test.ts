import { beforeEach, describe, expect, it, vi } from "vitest";
import "./executor-test-helpers.js";
import { TaskExecutor } from "../executor.js";
import { executorLog } from "../logger.js";
import { reviewStep } from "../reviewer.js";
import { createMockStore, mockedCreateFnAgent, mockedExecSync, resetExecutorMocks } from "./executor-test-helpers.js";

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "FN-4946-R",
    title: "Implicit revise guard",
    description: "",
    column: "in-progress",
    worktree: "/repo/.worktrees/swift-falcon",
    branch: "fusion/fn-4946-r",
    baseCommitSha: "abc123",
    taskDoneRetryCount: 0,
    dependencies: [],
    steps: [{ name: "Step 1", status: "in-progress" as const }],
    currentStep: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function refusal() {
  return {
    ok: false as const,
    refusalClass: "pending-code-review-revise" as const,
    reason: "Step 1 has pending REVISE",
    message: "fn_task_done refused (pending-code-review-revise): Step 1 has pending REVISE",
  };
}

describe("FN-4946 implicit completion + REVISE verdict interaction", () => {
  beforeEach(() => {
    resetExecutorMocks();
    mockedExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes("rev-parse --show-toplevel")) return Buffer.from("/repo/.worktrees/swift-falcon\n");
      if (cmd.includes("rev-parse --abbrev-ref HEAD")) return Buffer.from("fusion/fn-4946-r\n");
      if (cmd.includes("rev-list --count")) return Buffer.from("1\n");
      if (cmd.includes("rev-parse HEAD")) return Buffer.from("def456\n");
      return Buffer.from("");
    });
  });

  it("requeues with implicit-completion refusal shape and retry count", async () => {
    const store = createMockStore();
    const executor = new TaskExecutor(store as any, "/repo");

    await (executor as any).handleImplicitTaskDoneRefusal(makeTask({ id: "FN-4946-R1" }), "/repo/.worktrees/swift-falcon", refusal());

    expect(store.updateTask).toHaveBeenCalledWith("FN-4946-R1", expect.objectContaining({ taskDoneRetryCount: 1, status: "failed" }));
    expect(store.moveTask).toHaveBeenCalledWith("FN-4946-R1", "todo", { preserveProgress: true });
    const refusalLogCall = store.logEntry.mock.calls.find(
      ([id, message]: [string, string]) => id === "FN-4946-R1" && message.includes("pending-code-review-revise"),
    );
    expect(refusalLogCall).toBeTruthy();
    expect(executorLog.error).toHaveBeenCalledWith(expect.stringContaining("(implicit completion)"));
  });

  it("does not refuse implicit completion when REVISE is on an already done step", async () => {
    const store = createMockStore();
    let task: any = makeTask();

    store.getTask.mockImplementation(async () => ({ ...task, steps: task.steps.map((s: any) => ({ ...s })) }));
    store.updateStep.mockImplementation(async (_id: string, step: number, patch: any) => {
      task.steps[step] = { ...task.steps[step], ...patch };
    });

    vi.mocked(reviewStep).mockResolvedValue({ verdict: "REVISE", summary: "fix", review: "fix" } as any);

    mockedCreateFnAgent.mockImplementation(async ({ customTools }: any) => {
      const updateTool = customTools.find((t: any) => t.name === "fn_task_update");
      const reviewTool = customTools.find((t: any) => t.name === "fn_review_step");
      return {
        session: {
          prompt: vi.fn().mockImplementation(async () => {
            await reviewTool.execute("review", { step: 0, type: "code", step_name: "Step 1", baseline: "abc123" });
            await updateTool.execute("update", { step: 0, status: "done" });
          }),
          dispose: vi.fn(),
          subscribe: vi.fn(),
          on: vi.fn(),
          state: {},
        },
      } as any;
    });

    const executor = new TaskExecutor(store as any, "/repo");
    await executor.execute(task);

    expect(store.moveTask).toHaveBeenCalledWith("FN-4946-R", "in-review");
    expect(store.moveTask).not.toHaveBeenCalledWith("FN-4946-R", "todo", { preserveProgress: true });
  });

  it("does not double-burn retry count when refusal is already handled", async () => {
    const store = createMockStore();
    const executor = new TaskExecutor(store as any, "/repo");

    await (executor as any).handleImplicitTaskDoneRefusal(makeTask({ id: "FN-4946-R2" }), "/repo/.worktrees/swift-falcon", refusal());

    const retryCountUpdates = store.updateTask.mock.calls.filter(
      ([id, patch]: [string, Record<string, unknown>]) => id === "FN-4946-R2" && "taskDoneRetryCount" in patch,
    );
    expect(retryCountUpdates).toHaveLength(1);
    expect(retryCountUpdates[0]?.[1]).toEqual(expect.objectContaining({ taskDoneRetryCount: 1 }));
  });
});
