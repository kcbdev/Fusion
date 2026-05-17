import { describe, expect, it } from "vitest";
import { getProjectRootFromWorktree } from "../pi-extensions.js";

describe("getProjectRootFromWorktree", () => {
  it("detects POSIX worktree paths", () => {
    expect(getProjectRootFromWorktree("/repo/.worktrees/fn-001")).toBe("/repo");
    expect(getProjectRootFromWorktree("/repo/.worktrees/fn-001/src/file.ts")).toBe("/repo");
  });

  it("detects Windows worktree paths", () => {
    expect(getProjectRootFromWorktree("C:\\repo\\.worktrees\\fn-001")).toBe("C:\\repo");
    expect(getProjectRootFromWorktree("C:\\repo\\.worktrees\\fn-001\\src\\file.ts")).toBe("C:\\repo");
  });

  it("supports configured candidate worktrees dir paths", () => {
    expect(
      getProjectRootFromWorktree("/tmp/.fn-worktrees/repo/fn-001/src", {
        worktreesDirCandidates: ["/tmp/.fn-worktrees/repo"],
      }),
    ).toBe("/tmp/.fn-worktrees");

    expect(
      getProjectRootFromWorktree("/tmp/repo.worktrees/fn-001", {
        worktreesDirCandidates: ["/tmp/repo.worktrees"],
      }),
    ).toBe("/tmp");
  });
});
