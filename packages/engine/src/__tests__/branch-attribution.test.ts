import { describe, expect, it, vi } from "vitest";
import { BranchAttributionError, filterFilesToOwnTaskCommits } from "../branch-attribution.js";

describe("FN-5039 branch-attribution", () => {
  it("returns empty attribution for empty range", async () => {
    const execMock = vi
      .fn()
      .mockResolvedValueOnce({ stdout: "" })
      .mockResolvedValueOnce({ stdout: "" });

    const result = await filterFilesToOwnTaskCommits({
      worktreePath: "/tmp/wt",
      baseRef: "base",
      taskId: "FN-5039",
      execAsyncImpl: execMock as never,
    });

    expect(result).toEqual({
      files: [],
      foreignCommits: [],
      ownCommitCount: 0,
      rawDiffFileCount: 0,
    });
  });

  it("collects files from own-attributed commits only", async () => {
    const log = [
      "sha-own-1\x00own one\x00body\nFusion-Task-Id: FN-5039\n\x1e",
      "sha-own-2\x00own two\x00body\nFusion-Task-Id: FN-5039\n\x1e",
    ].join("");

    const execMock = vi
      .fn()
      .mockResolvedValueOnce({ stdout: "a.ts\nb.ts\n" })
      .mockResolvedValueOnce({ stdout: log })
      .mockResolvedValueOnce({ stdout: "a.ts\n" })
      .mockResolvedValueOnce({ stdout: "b.ts\na.ts\n" });

    const result = await filterFilesToOwnTaskCommits({
      worktreePath: "/tmp/wt",
      baseRef: "base",
      taskId: "FN-5039",
      execAsyncImpl: execMock as never,
    });

    expect(result.files).toEqual(["a.ts", "b.ts"]);
    expect(result.ownCommitCount).toBe(2);
    expect(result.foreignCommits).toEqual([]);
    expect(result.rawDiffFileCount).toBe(2);
  });

  it("treats foreign and untrailered commits as foreign", async () => {
    const log = [
      "sha-own\x00own\x00notes\nFusion-Task-Id: FN-5039\n\x1e",
      "sha-foreign\x00foreign\x00notes\nFusion-Task-Id: FN-1111\n\x1e",
      "sha-none\x00none\x00notes without trailer\x1e",
    ].join("");

    const execMock = vi
      .fn()
      .mockResolvedValueOnce({ stdout: "task.ts\nforeign.ts\nunt.ts\n" })
      .mockResolvedValueOnce({ stdout: log })
      .mockResolvedValueOnce({ stdout: "task.ts\n" });

    const result = await filterFilesToOwnTaskCommits({
      worktreePath: "/tmp/wt",
      baseRef: "base",
      taskId: "FN-5039",
      execAsyncImpl: execMock as never,
    });

    expect(result.files).toEqual(["task.ts"]);
    expect(result.foreignCommits).toEqual([
      { sha: "sha-foreign", subject: "foreign", attributedTaskId: "FN-1111" },
      { sha: "sha-none", subject: "none", attributedTaskId: null },
    ]);
  });

  it("throws BranchAttributionError on malformed git log output", async () => {
    const execMock = vi
      .fn()
      .mockResolvedValueOnce({ stdout: "x.ts\n" })
      .mockResolvedValueOnce({ stdout: "\x00missing sha\x00body\x1e" });

    await expect(
      filterFilesToOwnTaskCommits({
        worktreePath: "/tmp/wt",
        baseRef: "base",
        taskId: "FN-5039",
        execAsyncImpl: execMock as never,
      }),
    ).rejects.toBeInstanceOf(BranchAttributionError);
  });

  it("throws BranchAttributionError when git command fails", async () => {
    const execMock = vi.fn().mockRejectedValueOnce(new Error("fatal: bad revision"));

    await expect(
      filterFilesToOwnTaskCommits({
        worktreePath: "/tmp/wt",
        baseRef: "bad",
        taskId: "FN-5039",
        execAsyncImpl: execMock as never,
      }),
    ).rejects.toBeInstanceOf(BranchAttributionError);
  });
});
