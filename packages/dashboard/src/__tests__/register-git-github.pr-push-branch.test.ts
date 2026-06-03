// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fusionCore from "@fusion/core";
import type { Task, TaskStore } from "@fusion/core";

const { mockRunGitCommand } = vi.hoisted(() => ({
  mockRunGitCommand: vi.fn(),
}));

vi.mock("../routes/resolve-diff-base.js", () => ({
  runGitCommand: mockRunGitCommand,
}));

import { prRouteCommandRunner } from "../routes/register-git-github.js";
import { createServer } from "../server.js";
import { request as performRequest } from "../test-request.js";

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "FN-001",
    title: "Task",
    description: "desc",
    column: "in-review",
    status: "in-review",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    prInfo: {
      url: "https://github.com/owner/repo/pull/1",
      number: 1,
      status: "open",
      title: "PR",
      headBranch: "fusion/fn-001",
      baseBranch: "main",
      commentCount: 0,
    },
    comments: [],
    ...overrides,
  } as Task;
}

function createStore(task: Task): TaskStore {
  return {
    getTask: vi.fn().mockResolvedValue(task),
    listTasks: vi.fn().mockResolvedValue([]),
    createTask: vi.fn(),
    moveTask: vi.fn(),
    updateTask: vi.fn(),
    deleteTask: vi.fn(),
    mergeTask: vi.fn(),
    archiveTask: vi.fn(),
    unarchiveTask: vi.fn(),
    getSettings: vi.fn().mockResolvedValue({ defaultProvider: "mock", defaultModelId: "scripted" }),
    updateSettings: vi.fn(),
    logEntry: vi.fn().mockResolvedValue(undefined),
    getAgentLogs: vi.fn().mockResolvedValue([]),
    addSteeringComment: vi.fn(),
    updatePrInfo: vi.fn().mockResolvedValue(undefined),
    updatePrInfoByNumber: vi.fn().mockResolvedValue(undefined),
    addPrInfo: vi.fn().mockResolvedValue(undefined),
    removePrInfoByNumber: vi.fn().mockResolvedValue(undefined),
    updateIssueInfo: vi.fn().mockResolvedValue(undefined),
    getRootDir: vi.fn().mockReturnValue("/tmp/project"),
    getFusionDir: vi.fn().mockReturnValue("/tmp/project/.fusion"),
    getDatabase: vi.fn().mockReturnValue({
      exec: vi.fn(),
      prepare: vi.fn().mockReturnValue({ run: vi.fn().mockReturnValue({ changes: 0 }), get: vi.fn(), all: vi.fn().mockReturnValue([]) }),
    }),
    getMissionStore: vi.fn().mockReturnValue({ listMissions: vi.fn().mockReturnValue([]) }),
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as TaskStore;
}

type TryRunResult = Awaited<ReturnType<typeof prRouteCommandRunner.tryRun>>;
const runQueue: Array<{ ok: true; value: string } | { ok: false; error: Error }> = [];
const tryRunQueue: TryRunResult[] = [];

function queueRunSuccess(value = "") {
  runQueue.push({ ok: true, value });
}

function queueTryRunSuccess(value = "") {
  tryRunQueue.push({ ok: true, stdout: value });
}

describe("POST /pr/push-branch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runQueue.length = 0;
    tryRunQueue.length = 0;
    vi.spyOn(fusionCore, "isGhAuthenticated").mockReturnValue(true);
    vi.spyOn(prRouteCommandRunner, "run").mockImplementation(async () => {
      const next = runQueue.shift();
      if (!next) throw new Error("Unexpected run command");
      if (next.ok) return next.value;
      throw next.error;
    });
    vi.spyOn(prRouteCommandRunner, "tryRun").mockImplementation(async () => {
      const next = tryRunQueue.shift();
      if (!next) throw new Error("Unexpected tryRun command");
      return next;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects non in-review tasks", async () => {
    const app = createServer(createStore(createTask({ column: "todo", status: "todo" })));
    const response = await performRequest(app, "POST", "/api/tasks/FN-001/pr/push-branch", JSON.stringify({ base: "main" }), { "content-type": "application/json" });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("Task must be in 'in-review' column");
    expect(mockRunGitCommand).not.toHaveBeenCalled();
  });

  it("pushes the branch, logs it, and returns recomputed preflight", async () => {
    mockRunGitCommand
      .mockResolvedValueOnce("deadbeef\n")
      .mockResolvedValueOnce("2\n")
      .mockResolvedValueOnce("");
    queueTryRunSuccess("deadbeef\n");
    queueTryRunSuccess("refs/heads/fusion/fn-001\n");
    queueRunSuccess("2\n");
    queueRunSuccess("");
    queueRunSuccess("abc123\tAdd feature\tDev\n");
    queueRunSuccess("3\t1\tsrc/a.ts\n");
    queueRunSuccess("M\tsrc/a.ts\n");

    const store = createStore(createTask());
    const app = createServer(store);
    const response = await performRequest(app, "POST", "/api/tasks/FN-001/pr/push-branch", JSON.stringify({ base: "main" }), { "content-type": "application/json" });

    expect(response.status).toBe(200);
    expect(mockRunGitCommand).toHaveBeenNthCalledWith(1, ["rev-parse", "--verify", "refs/heads/fusion/fn-001"], "/tmp/project", 10000);
    expect(mockRunGitCommand).toHaveBeenNthCalledWith(2, ["rev-list", "--count", "main..fusion/fn-001"], "/tmp/project", 10000);
    expect(mockRunGitCommand).toHaveBeenNthCalledWith(3, ["push", "-u", "origin", "fusion/fn-001"], "/tmp/project", 60000);
    expect(response.body.result).toEqual({
      pushed: true,
      head: "fusion/fn-001",
      message: "Pushed fusion/fn-001 to origin.",
    });
    expect(response.body.preflight.branchOnRemote).toBe(true);
    expect(response.body.preflight.commitsPresent).toBe(true);
    expect(store.logEntry).toHaveBeenCalledWith("FN-001", "Pushed PR branch", "fusion/fn-001");
  });

  it("returns a structured badRequest when the branch has no commits", async () => {
    mockRunGitCommand
      .mockResolvedValueOnce("deadbeef\n")
      .mockResolvedValueOnce("0\n");

    const app = createServer(createStore(createTask()));
    const response = await performRequest(app, "POST", "/api/tasks/FN-001/pr/push-branch", JSON.stringify({ base: "main" }), { "content-type": "application/json" });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("Branch has no commits");
    expect(mockRunGitCommand).toHaveBeenCalledTimes(2);
  });

  it("maps git push failures to a structured API error", async () => {
    mockRunGitCommand
      .mockResolvedValueOnce("deadbeef\n")
      .mockResolvedValueOnce("2\n")
      .mockRejectedValueOnce(new Error("network unreachable"));

    const app = createServer(createStore(createTask()));
    const response = await performRequest(app, "POST", "/api/tasks/FN-001/pr/push-branch", JSON.stringify({ base: "main" }), { "content-type": "application/json" });

    expect(response.status).toBe(502);
    expect(response.body.error).toContain("network unreachable");
    expect(response.body.details.githubError.code).toBe("unknown");
  });
});
