import { beforeEach, describe, expect, it, vi } from "vitest";
import "./executor-test-helpers.js";
import type { Task } from "@fusion/core";
import { TaskExecutor } from "../executor.js";
import { removeWorktree } from "../worktree-pool.js";
import {
  createMockStore,
  mockCleanup,
  mockExecuteAll,
  mockedCreateFnAgent,
  mockedDescribeRegisteredWorktrees,
  mockedExecSync,
  resetExecutorMocks,
} from "./executor-test-helpers.js";

const mockedRemoveWorktree = vi.mocked(removeWorktree);

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "FN-7174",
    title: "Preserve stuck progress",
    description: "# test\n## Steps\n### Step 0: Preflight\n- [ ] check\n### Step 1: Implement\n- [ ] code",
    prompt: "# test\n## Steps\n### Step 0: Preflight\n- [ ] check\n### Step 1: Implement\n- [ ] code",
    column: "in-progress",
    dependencies: [],
    steps: [
      { name: "Step 0", status: "done" },
      { name: "Step 1", status: "in-progress" },
      { name: "Step 2", status: "pending" },
    ],
    currentStep: 2,
    log: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    worktree: "/tmp/test/.worktrees/fn-7174-worktree",
    branch: "fusion/fn-7174",
    baseCommitSha: "base-sha",
    enabledWorkflowSteps: [],
    ...overrides,
  };
}

function installGitResult(kind: "uncommitted-only" | "committed") {
  mockedExecSync.mockImplementation((cmd: string) => {
    if (cmd.includes("git rev-parse --is-inside-work-tree")) return "true\n";
    if (cmd.includes("git merge-base")) return "base-sha\n";
    if (cmd.includes("git rev-parse")) {
      return kind === "uncommitted-only" ? "base-sha\n" : "branch-sha\n";
    }
    return "";
  });
}

function installGitProofFailure() {
  mockedExecSync.mockImplementation((cmd: string) => {
    if (cmd.includes("git rev-parse --is-inside-work-tree")) return "true\n";
    if (cmd.includes("git merge-base")) throw new Error("fatal: not a valid object name fusion/fn-7174");
    return "";
  });
}

function createMutableStore(task: Task, settings: Record<string, unknown> = {}) {
  const store = createMockStore();
  store.getSettings.mockResolvedValue({
    maxConcurrent: 2,
    maxWorktrees: 4,
    pollIntervalMs: 15000,
    groupOverlappingFiles: false,
    autoMerge: false,
    ...settings,
  });
  store.getTask.mockImplementation(async () => task);
  store.updateStep.mockImplementation(async (_taskId: string, stepIndex: number, status: Task["steps"][number]["status"]) => {
    task.steps[stepIndex].status = status;
    return task;
  });
  store.updateTask.mockImplementation(async (_taskId: string, updates: Partial<Task>) => {
    Object.assign(task, updates);
    return task;
  });
  store.moveTask.mockImplementation(async (_taskId: string, column: Task["column"]) => {
    task.column = column;
    return task;
  });
  return store;
}

function installSingleSession(resolvePrompt: () => Promise<void> | void = async () => {}) {
  let started!: () => void;
  const startedPromise = new Promise<void>((resolve) => {
    started = resolve;
  });
  const session = {
    prompt: vi.fn().mockImplementation(async () => {
      started();
      await resolvePrompt();
    }),
    dispose: vi.fn(),
    subscribe: vi.fn(),
    on: vi.fn(),
    setThinkingLevel: vi.fn(),
    sessionManager: { getLeafId: vi.fn().mockReturnValue("leaf-1") },
    getSessionStats: vi.fn().mockReturnValue({ tokens: {} }),
  };
  mockedCreateFnAgent.mockResolvedValue({ session, sessionFile: "/tmp/session.json" } as any);
  return { session, startedPromise };
}

async function runSingleSessionStuckRequeue(task: Task, settings: Record<string, unknown> = {}) {
  const store = createMutableStore(task, settings);
  let releasePrompt!: () => void;
  const promptRelease = new Promise<void>((resolve) => {
    releasePrompt = resolve;
  });
  const { startedPromise } = installSingleSession(() => promptRelease);
  const executor = new TaskExecutor(store as any, "/tmp/test", {});

  const executePromise = executor.execute(task);
  await startedPromise;
  executor.markStuckAborted(task.id, true);
  releasePrompt();
  await executePromise;
  return { store, executor };
}

async function runStepSessionStuckRequeue(task: Task, settings: Record<string, unknown> = {}) {
  const store = createMutableStore(task, {
    runStepsInNewSessions: true,
    maxParallelSteps: 2,
    ...settings,
  });
  let release!: () => void;
  mockExecuteAll.mockReturnValue(new Promise<void>((resolve) => {
    release = resolve;
  }));
  const executor = new TaskExecutor(store as any, "/tmp/test", {});

  const executePromise = executor.execute(task);
  await vi.waitFor(() => expect((executor as any).activeStepExecutors.has(task.id)).toBe(true));
  executor.markStuckAborted(task.id, true);
  release();
  await executePromise;
  return { store, executor };
}

describe("TaskExecutor stuck requeue preserve-progress reconciliation", () => {
  beforeEach(() => {
    resetExecutorMocks();
    mockedRemoveWorktree.mockResolvedValue(undefined as any);
    mockedDescribeRegisteredWorktrees.mockResolvedValue({
      rawOutput: "worktree /tmp/test/.worktrees/fn-7174-worktree\nbranch refs/heads/fusion/fn-7174\n",
      canonicalized: ["/tmp/test/.worktrees/fn-7174-worktree"],
    });
    mockCleanup.mockResolvedValue(undefined);
    installGitResult("uncommitted-only");
  });

  it("reproduces the default preserve-progress corruption case and resets uncommitted-only steps before removing the worktree", async () => {
    const task = createTask();
    const { store } = await runSingleSessionStuckRequeue(task);

    expect(task.steps.map((step) => step.status)).toEqual(["pending", "pending", "pending"]);
    expect(task.currentStep).toBe(0);
    expect(store.updateStep).toHaveBeenCalledTimes(2);
    expect(mockedRemoveWorktree).toHaveBeenCalledWith(expect.objectContaining({
      worktreePath: "/tmp/test/.worktrees/fn-7174-worktree",
      taskId: task.id,
      expectedOwnerTaskId: task.id,
    }));
    expect(store.updateTask).toHaveBeenCalledWith(task.id, expect.objectContaining({
      worktree: null,
      branch: null,
    }));
    expect(store.moveTask).toHaveBeenCalledWith(task.id, "todo", { preserveProgress: true });
  });

  it("resets steps when git cannot prove a stale branch has durable commits before cleanup", async () => {
    installGitProofFailure();
    const task = createTask({ branch: "fusion/missing-fn-7174" });
    const { store } = await runSingleSessionStuckRequeue(task);

    expect(task.steps.map((step) => step.status)).toEqual(["pending", "pending", "pending"]);
    expect(task.currentStep).toBe(0);
    expect(store.updateStep).toHaveBeenCalledTimes(2);
    expect(mockedRemoveWorktree).toHaveBeenCalled();
    expect(store.moveTask).toHaveBeenCalledWith(task.id, "todo", { preserveProgress: true });
  });

  it("keeps committed step progress unchanged on preserve-progress stuck requeue", async () => {
    installGitResult("committed");
    const task = createTask();
    const { store } = await runSingleSessionStuckRequeue(task);

    expect(task.steps.map((step) => step.status)).toEqual(["done", "in-progress", "pending"]);
    expect(task.currentStep).toBe(2);
    expect(store.updateStep).not.toHaveBeenCalled();
    expect(mockedRemoveWorktree).toHaveBeenCalled();
    expect(store.moveTask).toHaveBeenCalledWith(task.id, "todo", { preserveProgress: true });
  });

  it("keeps preserveProgress=false reset behavior while moving without preserve options", async () => {
    const task = createTask();
    const { store } = await runSingleSessionStuckRequeue(task, { preserveProgressOnStuckRequeue: false });

    expect(task.steps.map((step) => step.status)).toEqual(["pending", "pending", "pending"]);
    expect(task.currentStep).toBe(0);
    expect(store.moveTask).toHaveBeenCalledWith(task.id, "todo", undefined);
  });

  it("does nothing for no-work tasks with no completed or in-progress steps", async () => {
    const task = createTask({
      steps: [
        { name: "Step 0", status: "pending" },
        { name: "Step 1", status: "pending" },
      ],
      currentStep: 0,
    });
    const { store } = await runSingleSessionStuckRequeue(task);

    expect(store.updateStep).not.toHaveBeenCalled();
    expect(task.steps.map((step) => step.status)).toEqual(["pending", "pending"]);
    expect(store.moveTask).toHaveBeenCalledWith(task.id, "todo", { preserveProgress: true });
  });

  it("preserves the concurrent-recovery guard without removing worktree or moving to todo", async () => {
    const task = createTask({ column: "in-review" });
    const store = createMutableStore(task);
    let releasePrompt!: () => void;
    const promptRelease = new Promise<void>((resolve) => {
      releasePrompt = resolve;
    });
    const { startedPromise } = installSingleSession(() => promptRelease);
    const executor = new TaskExecutor(store as any, "/tmp/test", {});

    const executePromise = executor.execute({ ...task, column: "in-progress" });
    await startedPromise;
    executor.markStuckAborted(task.id, true);
    releasePrompt();
    await executePromise;

    expect(store.updateStep).not.toHaveBeenCalled();
    expect(mockedRemoveWorktree).not.toHaveBeenCalled();
    expect(store.moveTask).not.toHaveBeenCalledWith(task.id, "todo", expect.anything());
    expect(store.moveTask).not.toHaveBeenCalledWith(task.id, "todo");
  });

  it("applies the same lost-work reconciliation to the step-session requeue path", async () => {
    const task = createTask();
    const { store } = await runStepSessionStuckRequeue(task);

    expect(task.steps.map((step) => step.status)).toEqual(["pending", "pending", "pending"]);
    expect(task.currentStep).toBe(0);
    expect(store.updateStep).toHaveBeenCalledTimes(2);
    expect(mockedRemoveWorktree).toHaveBeenCalled();
    expect(store.moveTask).toHaveBeenCalledWith(task.id, "todo", { preserveProgress: true });
  });

  it("applies the same lost-work reconciliation to the force-requeue grace-timeout path", async () => {
    vi.useFakeTimers();
    const task = createTask();
    const store = createMutableStore(task);
    let releasePrompt!: () => void;
    const promptRelease = new Promise<void>((resolve) => {
      releasePrompt = resolve;
    });
    const { startedPromise } = installSingleSession(() => promptRelease);
    const executor = new TaskExecutor(store as any, "/tmp/test", {});

    const executePromise = executor.execute(task);
    await startedPromise;
    executor.markStuckAborted(task.id, true);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(task.steps.map((step) => step.status)).toEqual(["pending", "pending", "pending"]);
    expect(task.currentStep).toBe(0);
    expect(mockedRemoveWorktree).toHaveBeenCalled();
    expect(store.moveTask).toHaveBeenCalledWith(task.id, "todo", { preserveProgress: true });

    releasePrompt();
    await executePromise;
  });
});
