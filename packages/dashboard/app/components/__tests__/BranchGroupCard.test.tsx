import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BranchGroupCard } from "../BranchGroupCard";

const apiGetBranchGroup = vi.fn();
const apiPromoteBranchGroup = vi.fn();

vi.mock("../../api", () => ({
  apiGetBranchGroup: (...args: unknown[]) => apiGetBranchGroup(...args),
  apiPromoteBranchGroup: (...args: unknown[]) => apiPromoteBranchGroup(...args),
}));

vi.mock("../../sse-bus", () => ({
  subscribeSse: () => () => {},
}));

vi.mock("lucide-react", () => ({
  CheckCircle2: () => null,
  CircleDashed: () => null,
  ExternalLink: () => null,
  GitBranch: () => null,
  GitPullRequest: () => null,
  Loader2: () => null,
}));

function makeGroup(overrides: Record<string, unknown> = {}) {
  return {
    id: "BG-1",
    sourceType: "planning",
    sourceId: "PS-1",
    branchName: "feature/shared",
    autoMerge: false,
    prState: "none",
    status: "open",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    members: [
      { taskId: "FN-1", title: "one", column: "done", landed: true },
      { taskId: "FN-2", title: "two", column: "in-review", landed: false },
    ],
    completion: { landed: 1, total: 2, complete: false },
    ...overrides,
  };
}

describe("BranchGroupCard", () => {
  beforeEach(() => {
    apiGetBranchGroup.mockReset();
    apiPromoteBranchGroup.mockReset();
  });

  it("hides promote control while incomplete", async () => {
    apiGetBranchGroup.mockResolvedValue({ group: makeGroup() });
    render(<BranchGroupCard groupId="BG-1" />);
    await screen.findByText("1 of 2 members finished");
    expect(screen.queryByRole("button", { name: /open pr|merge group into main/i })).toBeNull();
  });

  it("shows promote and calls API when complete + autoMerge off", async () => {
    apiGetBranchGroup
      .mockResolvedValueOnce({ group: makeGroup({ completion: { landed: 2, total: 2, complete: true }, members: [{ taskId: "FN-1", title: "one", column: "done", landed: true }, { taskId: "FN-2", title: "two", column: "done", landed: true }] }) })
      .mockResolvedValueOnce({ group: makeGroup({ completion: { landed: 2, total: 2, complete: true }, members: [{ taskId: "FN-1", title: "one", column: "done", landed: true }, { taskId: "FN-2", title: "two", column: "done", landed: true }], prState: "open", prNumber: 22, prUrl: "https://example/pr/22" }) });
    apiPromoteBranchGroup.mockResolvedValue({ groupId: "BG-1", prState: "open" });

    render(<BranchGroupCard groupId="BG-1" />);
    const button = await screen.findByRole("button", { name: /open pr/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(apiPromoteBranchGroup).toHaveBeenCalledWith("BG-1", undefined);
    });
  });

  it("shows auto-merge badge when complete and autoMerge is on", async () => {
    apiGetBranchGroup.mockResolvedValue({
      group: makeGroup({
        autoMerge: true,
        completion: { landed: 2, total: 2, complete: true },
        members: [{ taskId: "FN-1", title: "one", column: "done", landed: true }, { taskId: "FN-2", title: "two", column: "done", landed: true }],
      }),
    });

    render(<BranchGroupCard groupId="BG-1" />);
    expect(await screen.findByText("Auto-merge enabled")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /open pr|merge group into main/i })).toBeNull();
  });

  it("renders tracked group PR link when present", async () => {
    apiGetBranchGroup.mockResolvedValue({
      group: makeGroup({ completion: { landed: 2, total: 2, complete: true }, members: [{ taskId: "FN-1", title: "one", column: "done", landed: true }, { taskId: "FN-2", title: "two", column: "done", landed: true }], prState: "open", prNumber: 9, prUrl: "https://example/pr/9" }),
    });
    render(<BranchGroupCard groupId="BG-1" />);
    expect(await screen.findByRole("link", { name: /pr #9/i })).toBeInTheDocument();
  });
});
