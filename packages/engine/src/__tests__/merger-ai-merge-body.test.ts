import { describe, expect, it, vi } from "vitest";

vi.mock("../pi.js", () => ({
  createFnAgent: vi.fn(),
  describeModel: vi.fn(() => "mock-provider/mock-model"),
  promptWithFallback: vi.fn(),
  compactSessionContext: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execSync: vi.fn(() => ""),
  exec: vi.fn(),
  execFile: vi.fn(),
}));

import { composeMergeCommitBody } from "../merger.js";

describe("composeMergeCommitBody", () => {
  const commitLog = "- feat: one";
  const diffStat = "1 file changed";

  it("uses deterministic fallback when AI summary and AI body are absent", () => {
    expect(composeMergeCommitBody({ branch: "fusion/FN-1", commitLog, diffStat })).toBe(
      "Commits merged:\n- feat: one\n\nFiles changed:\n1 file changed",
    );
  });

  it("combines AI narrative + bullets + files changed", () => {
    expect(composeMergeCommitBody({
      branch: "fusion/FN-1",
      commitLog,
      diffStat,
      aiSummary: "Narrative summary.",
      aiBody: "- bullet one\n- bullet two",
    })).toBe("Narrative summary.\n\n- bullet one\n- bullet two\n\nFiles changed:\n1 file changed");
  });

  it("keeps AI narrative with files changed when bullets are absent", () => {
    expect(composeMergeCommitBody({ branch: "fusion/FN-1", commitLog, diffStat, aiSummary: "Narrative summary." }))
      .toBe("Narrative summary.\n\nFiles changed:\n1 file changed");
  });

  it("keeps AI bullet body with files changed when narrative is absent", () => {
    expect(composeMergeCommitBody({ branch: "fusion/FN-1", commitLog, diffStat, aiBody: "- bullet one" }))
      .toBe("- bullet one\n\nFiles changed:\n1 file changed");
  });
});
