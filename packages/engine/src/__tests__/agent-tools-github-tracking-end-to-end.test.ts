import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TaskStore, resolveTaskGithubTracking, setTaskCreatedHook } from "@fusion/core";
import { createDelegateTaskTool, createTaskCreateTool } from "../agent-tools.js";

const { githubTrackingHookPath, githubTrackingPath, maybeCreateTrackingIssueMock } = vi.hoisted(() => ({
  githubTrackingHookPath: new URL("../../../dashboard/src/github-tracking-hook.js", import.meta.url).href,
  githubTrackingPath: new URL("../../../dashboard/src/github-tracking.js", import.meta.url).href,
  maybeCreateTrackingIssueMock: vi.fn(async () => ({
    created: false as const,
    reason: "tracking_disabled" as const,
  })),
}));

vi.mock("@fusion/core", async (importOriginal) => {
  const { createEngineCoreMock } = await import("../test/mockCore.js");
  return createEngineCoreMock(() => importOriginal<typeof import("@fusion/core")>(), {
    isGhAvailable: vi.fn(() => true),
    isGhAuthenticated: vi.fn(() => true),
  });
});

vi.mock(githubTrackingPath, async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../dashboard/src/github-tracking.js")>();
  return {
    ...original,
    maybeCreateTrackingIssue: maybeCreateTrackingIssueMock,
  };
});

function makeTmpDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe("agent tool github tracking end-to-end", () => {
  let rootDir: string;
  let globalDir: string;
  let store: TaskStore;

  beforeEach(async () => {
    setTaskCreatedHook(undefined);
    vi.clearAllMocks();
    rootDir = makeTmpDir("kb-engine-agent-tools-gh-track-e2e-");
    globalDir = makeTmpDir("kb-engine-agent-tools-gh-track-e2e-global-");
    store = new TaskStore(rootDir, globalDir, { inMemoryDb: true });
    await store.init();
    await store.updateSettings({
      githubTrackingEnabledByDefault: true,
      githubTrackingDefaultRepo: "owner/repo",
    });
  });

  afterEach(async () => {
    setTaskCreatedHook(undefined);
    store.close();
    await rm(rootDir, { recursive: true, force: true });
    await rm(globalDir, { recursive: true, force: true });
  });

  it.each([
    {
      name: "fn_task_create",
      run: async () => createTaskCreateTool(store, { sourceType: "api" }).execute(
        "call-1",
        { description: "agent-created tracked task" } as never,
        undefined,
        undefined,
        {} as never,
      ),
    },
    {
      name: "fn_delegate_task",
      run: async () => createDelegateTaskTool({
        getAgent: vi.fn().mockResolvedValue({ id: "agent-1", name: "Worker", role: "executor", state: "idle" }),
      } as never, store).execute(
        "call-1",
        { agent_id: "agent-1", description: "delegated tracked task" } as never,
        undefined,
        undefined,
        {} as never,
      ),
    },
  ])("invokes maybeCreateTrackingIssue for $name", async ({ run }) => {
    const { registerGithubTrackingHook } = await import(githubTrackingHookPath);
    const { maybeCreateTrackingIssue } = await import(githubTrackingPath);
    const maybeCreateSpy = vi.mocked(maybeCreateTrackingIssue);

    registerGithubTrackingHook();

    const result = await run();
    const taskId = (result as { details?: { taskId?: string } }).details?.taskId as string;
    expect(taskId).toMatch(/^FN-/);

    expect(maybeCreateSpy).toHaveBeenCalledTimes(1);
    const [taskArg, depsArg] = (maybeCreateSpy.mock.calls[0] ?? []) as [
      { id?: string } | undefined,
      { projectSettings?: unknown; globalSettings?: unknown } | undefined,
    ];
    expect(taskArg?.id).toBe(taskId);

    const persisted = await store.getTask(taskId);
    expect(persisted).toBeTruthy();
    expect(persisted?.githubTracking?.enabled).toBe(true);
    const resolvedTracking = resolveTaskGithubTracking(
      persisted!,
      depsArg?.projectSettings as never,
      depsArg?.globalSettings as never,
    );
    expect(resolvedTracking.enabled).toBe(true);
    expect(resolvedTracking.repo).toEqual({ owner: "owner", repo: "repo" });
  });
});
