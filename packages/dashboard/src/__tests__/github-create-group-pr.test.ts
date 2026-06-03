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

import { runGh, runGhJsonAsync } from "@fusion/core";
import { GitHubClient, createGroupPullRequest, buildGroupPullRequestTitle, buildGroupPullRequestBody } from "../github.js";

const mockRunGh = vi.mocked(runGh);
const mockRunGhJsonAsync = vi.mocked(runGhJsonAsync);

const group = {
  id: "BG-1",
  branchName: "fusion/groups/planning-x",
  sourceType: "planning" as const,
  sourceId: "PS-1",
};
const members = [
  { id: "FN-A", title: "Alpha" },
  { id: "FN-B", title: "Beta" },
];

describe("createGroupPullRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a PR via the gh-CLI backend and returns persisted shape", async () => {
    // findPrForBranch (gh): no existing PR.
    mockRunGhJsonAsync.mockResolvedValueOnce([] as any);
    // createPr (gh): returns the PR url on stdout.
    mockRunGh.mockReturnValue("https://github.com/owner/repo/pull/55\n");
    const client = new GitHubClient({ forceMode: "gh-cli" });

    const result = await createGroupPullRequest(client, {
      group,
      members,
      headBranch: group.branchName,
      baseBranch: "main",
    });

    expect(result).toEqual({
      prNumber: 55,
      prUrl: "https://github.com/owner/repo/pull/55",
      prState: "open",
    });
    const createArgs = mockRunGh.mock.calls[0][0];
    expect(createArgs).toEqual(expect.arrayContaining(["pr", "create", "--head", group.branchName, "--base", "main"]));
  });

  it("creates a PR via the REST API backend and returns persisted shape", async () => {
    const client = new GitHubClient({ token: "ghp_token", forceMode: "token" });
    const fetchSpy = vi.spyOn(global, "fetch" as any)
      // findPrForBranch (API): empty list.
      .mockResolvedValueOnce({ ok: true, json: async () => [] } as any)
      // createPr (API).
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          number: 77,
          html_url: "https://github.com/owner/repo/pull/77",
          title: "T",
          state: "open",
          head: { ref: group.branchName },
          base: { ref: "main" },
          comments: 0,
        }),
      } as any);

    const result = await createGroupPullRequest(client, {
      group,
      members,
      headBranch: group.branchName,
      baseBranch: "main",
    });

    expect(result).toEqual({
      prNumber: 77,
      prUrl: "https://github.com/owner/repo/pull/77",
      prState: "open",
    });
    fetchSpy.mockRestore();
  });

  it("reuses an existing open PR instead of creating a second one (idempotent)", async () => {
    mockRunGhJsonAsync.mockResolvedValueOnce([
      { number: 12, url: "https://github.com/owner/repo/pull/12", title: "T", state: "OPEN", baseRefName: "main", headRefName: group.branchName, mergedAt: null },
    ] as any);
    const client = new GitHubClient({ forceMode: "gh-cli" });

    const result = await createGroupPullRequest(client, {
      group,
      members,
      headBranch: group.branchName,
      baseBranch: "main",
    });

    expect(result).toEqual({
      prNumber: 12,
      prUrl: "https://github.com/owner/repo/pull/12",
      prState: "open",
    });
    // createPr must NOT have been called.
    expect(mockRunGh).not.toHaveBeenCalled();
  });
});

describe("group PR title/body builders", () => {
  it("title includes the group id, source, and member count", () => {
    expect(buildGroupPullRequestTitle(group, members)).toBe("BG-1: planning/PS-1 (2 tasks)");
  });

  it("body lists every member task", () => {
    const body = buildGroupPullRequestBody(group, members);
    expect(body).toContain("Automated group PR for BG-1.");
    expect(body).toContain("- FN-A: Alpha");
    expect(body).toContain("- FN-B: Beta");
  });
});
