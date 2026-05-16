import { describe, expect, it, vi, type Mock } from "vitest";
import type { TaskStore } from "@fusion/core";
import { GitHubTrackingReconciler } from "../github-tracking-reconciler.js";

const { mockGetIssue, mockSetIssueState } = vi.hoisted(() => ({
  mockGetIssue: vi.fn(),
  mockSetIssueState: vi.fn(),
}));

const { mockResolveGithubTrackingAuth } = vi.hoisted(() => ({
  mockResolveGithubTrackingAuth: vi.fn(),
}));

vi.mock("../github.js", () => ({
  GitHubClient: vi.fn().mockImplementation(() => ({
    getIssue: (...args: unknown[]) => mockGetIssue(...args),
    setIssueState: (...args: unknown[]) => mockSetIssueState(...args),
  })),
}));

vi.mock("../github-auth.js", () => ({
  resolveGithubTrackingAuth: (...args: unknown[]) => mockResolveGithubTrackingAuth(...args),
}));

function createStore(tasks: Array<Record<string, unknown>>): TaskStore {
  return {
    listTasks: vi.fn().mockResolvedValue(tasks),
    logEntry: vi.fn().mockResolvedValue(undefined),
    getSettings: vi.fn().mockResolvedValue({ githubAuthMode: "token", githubAuthToken: "ghp_test" }),
    getGlobalSettingsStore: vi.fn(() => ({ getSettings: vi.fn().mockResolvedValue({}) })),
  } as unknown as TaskStore;
}

describe("GitHubTrackingReconciler", () => {
  it("closes already-done tasks whose linked issue is still open", async () => {
    mockResolveGithubTrackingAuth.mockReturnValue({ ok: true, auth: { mode: "token", token: "ghp_test" } });
    mockGetIssue.mockResolvedValue({ state: "open" });
    const store = createStore([
      {
        id: "FN-1",
        status: "done",
        githubTracking: {
          enabled: true,
          issue: { owner: "owner", repo: "repo", number: 42 },
        },
      },
    ]);

    const reconciler = new GitHubTrackingReconciler();
    await reconciler.reconcile(store);

    expect(mockSetIssueState).toHaveBeenCalledWith("owner", "repo", 42, "closed", "completed");
  });
});
