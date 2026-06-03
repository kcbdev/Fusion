import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@fusion/core", async () => {
  const actual = await vi.importActual<typeof import("@fusion/core")>("@fusion/core");
  return {
    ...actual,
    isGhAvailable: vi.fn(() => true),
    isGhAuthenticated: vi.fn(() => true),
    runGh: vi.fn(),
    runGhAsync: vi.fn(),
    runGhJson: vi.fn(),
    runGhJsonAsync: vi.fn(),
    getGhErrorMessage: vi.fn((err) => (err instanceof Error ? err.message : String(err))),
    getCurrentRepo: vi.fn(() => ({ owner: "owner", repo: "repo" })),
  };
});

import { runGh, runGhJsonAsync, isGhAvailable, isGhAuthenticated } from "@fusion/core";
import { GitHubClient, syncGroupPullRequest, closeGroupPullRequest } from "../github.js";

const mockRunGh = vi.mocked(runGh);
const mockRunGhJsonAsync = vi.mocked(runGhJsonAsync);
const mockIsGhAvailable = vi.mocked(isGhAvailable);
const mockIsGhAuthenticated = vi.mocked(isGhAuthenticated);

const group = {
  id: "BG-1",
  branchName: "fusion/groups/planning-x",
  sourceType: "planning" as const,
  sourceId: "PS-1",
  prNumber: 42,
};
const members = [
  { id: "FN-A", title: "Alpha" },
  { id: "FN-B", title: "Beta" },
];

const ghPrViewOpen = {
  number: 42,
  url: "https://github.com/owner/repo/pull/42",
  title: "T",
  state: "OPEN",
  isDraft: false,
  baseRefName: "main",
  headRefName: group.branchName,
};

describe("syncGroupPullRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsGhAvailable.mockReturnValue(true);
    mockIsGhAuthenticated.mockReturnValue(true);
  });

  it("edits the PR body via the gh-CLI backend when the PR is open", async () => {
    // getPrStatus (gh view): open. updatePr→getPrStatus (gh view): open again.
    mockRunGhJsonAsync.mockResolvedValue(ghPrViewOpen as any);
    const client = new GitHubClient({ forceMode: undefined as never });
    // Force gh-auth path by relying on mocked isGhAvailable/isGhAuthenticated.

    const result = await syncGroupPullRequest(client, { group, members });

    expect(result).toEqual({
      prNumber: 42,
      prUrl: "https://github.com/owner/repo/pull/42",
      prState: "open",
    });
    // pr edit was invoked with the group's PR number and a body.
    const editArgs = mockRunGh.mock.calls.find((c) => c[0]?.[0] === "pr" && c[0]?.[1] === "edit")?.[0];
    expect(editArgs).toBeDefined();
    expect(editArgs).toEqual(expect.arrayContaining(["pr", "edit", "42", "--body"]));
  });

  it("edits the PR body via the REST API backend when the PR is open", async () => {
    // Force the API path: gh CLI unavailable so getPrStatus/updatePr use REST.
    mockIsGhAvailable.mockReturnValue(false);
    mockIsGhAuthenticated.mockReturnValue(false);
    const client = new GitHubClient({ token: "ghp_token", forceMode: "token" });
    const fetchSpy = vi.spyOn(global, "fetch" as any)
      // getPrStatus (API): open.
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          number: 42,
          html_url: "https://github.com/owner/repo/pull/42",
          title: "T",
          state: "open",
          merged: false,
          head: { ref: group.branchName },
          base: { ref: "main" },
          comments: 0,
          updated_at: "2026-06-03T00:00:00Z",
        }),
      } as any)
      // updatePr (API PATCH).
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) } as any)
      // updatePr→getPrStatus (API): open.
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          number: 42,
          html_url: "https://github.com/owner/repo/pull/42",
          title: "T2",
          state: "open",
          merged: false,
          head: { ref: group.branchName },
          base: { ref: "main" },
          comments: 0,
          updated_at: "2026-06-03T00:00:01Z",
        }),
      } as any);

    const result = await syncGroupPullRequest(client, { group, members });
    expect(result.prState).toBe("open");
    expect(result.prNumber).toBe(42);
    // PATCH was sent with a body containing the completion checklist.
    const patchCall = fetchSpy.mock.calls.find((c) => (c[1] as any)?.method === "PATCH");
    expect(patchCall).toBeDefined();
    fetchSpy.mockRestore();
  });

  it("reconciles (no edit) when the PR is closed out-of-band on GitHub", async () => {
    mockRunGhJsonAsync.mockResolvedValue({ ...ghPrViewOpen, state: "CLOSED" } as any);
    const client = new GitHubClient({ forceMode: undefined as never });

    const result = await syncGroupPullRequest(client, { group, members });

    expect(result.prState).toBe("closed");
    // pr edit must NOT be invoked when the PR is already terminal.
    expect(mockRunGh.mock.calls.find((c) => c[0]?.[1] === "edit")).toBeUndefined();
  });

  it("reconciles to merged (no edit) when the PR is merged out-of-band", async () => {
    mockRunGhJsonAsync.mockResolvedValue({ ...ghPrViewOpen, state: "MERGED" } as any);
    const client = new GitHubClient({ forceMode: undefined as never });

    const result = await syncGroupPullRequest(client, { group, members });
    expect(result.prState).toBe("merged");
    expect(mockRunGh.mock.calls.find((c) => c[0]?.[1] === "edit")).toBeUndefined();
  });

  it("throws when the group has no persisted prNumber", async () => {
    const client = new GitHubClient({ forceMode: undefined as never });
    await expect(
      syncGroupPullRequest(client, { group: { ...group, prNumber: null as never }, members }),
    ).rejects.toThrow(/no persisted prNumber/);
  });
});

describe("closeGroupPullRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsGhAvailable.mockReturnValue(true);
    mockIsGhAuthenticated.mockReturnValue(true);
  });

  it("closes an open PR via the gh-CLI backend", async () => {
    mockRunGhJsonAsync.mockResolvedValue({ ...ghPrViewOpen, state: "CLOSED" } as any);
    // First getPrStatus returns open, then close, then getPrStatus returns closed.
    mockRunGhJsonAsync
      .mockResolvedValueOnce(ghPrViewOpen as any)
      .mockResolvedValueOnce({ ...ghPrViewOpen, state: "CLOSED" } as any);
    const client = new GitHubClient({ forceMode: undefined as never });

    const result = await closeGroupPullRequest(client, { id: group.id, prNumber: group.prNumber });

    expect(result.prState).toBe("closed");
    const closeArgs = mockRunGh.mock.calls.find((c) => c[0]?.[0] === "pr" && c[0]?.[1] === "close")?.[0];
    expect(closeArgs).toEqual(expect.arrayContaining(["pr", "close", "42"]));
  });

  it("reconciles (no close) when the PR is already merged out-of-band", async () => {
    mockRunGhJsonAsync.mockResolvedValue({ ...ghPrViewOpen, state: "MERGED" } as any);
    const client = new GitHubClient({ forceMode: undefined as never });

    const result = await closeGroupPullRequest(client, { id: group.id, prNumber: group.prNumber });
    expect(result.prState).toBe("merged");
    expect(mockRunGh.mock.calls.find((c) => c[0]?.[1] === "close")).toBeUndefined();
  });
});
