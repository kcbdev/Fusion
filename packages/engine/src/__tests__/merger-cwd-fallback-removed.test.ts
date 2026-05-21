import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("../pi.js", () => ({
  createFnAgent: vi.fn(async () => ({
    prompt: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
  })),
  describeModel: vi.fn(() => "mock-provider/mock-model"),
  promptWithFallback: vi.fn(async (session: { prompt: (prompt: string) => Promise<unknown> }, prompt: string) => {
    await session.prompt(prompt);
  }),
  compactSessionContext: vi.fn(),
}));

import { aiMergeTask } from "../merger.js";
import { mergerLog } from "../logger.js";
import { resolveMergeIntegrationRoot } from "../merger-integration-worktree.js";
import { git, hasGit, makeReliabilityFixture } from "./reliability-interactions/_helpers.js";

describe("FN-5348 cwd integration fallback removed", () => {
  it.skipIf(!hasGit)("Scenario A/B: dirty refusal keeps integration ref unchanged and emits refusal audit on master", async () => {
    const fixture = await makeReliabilityFixture({
      taskId: "FN-5348-DIRTY-REFUSAL",
      settings: {
        baseBranch: "master",
        mergeIntegrationWorktree: "reuse-task-worktree",
      } as any,
    });

    try {
      const { rootDir, store, task } = fixture;
      const actualTask = await store.getTask(task.id);
      const branch = `fusion/${actualTask!.id.toLowerCase()}`;
      const worktreeRoot = `${rootDir}-worktrees`;
      const worktreePath = join(worktreeRoot, actualTask!.id.toLowerCase());

      git(rootDir, "git branch -m main master");
      const completedSteps = (actualTask?.steps ?? []).map((step) => ({ ...step, status: "done" as const }));
      await store.updateTask(task.id, {
        baseBranch: "master",
        branch,
        steps: completedSteps,
        currentStep: completedSteps.length,
      } as any);
      await fixture.createBranch(branch);
      await fixture.writeAndCommit("packages/engine/src/fn-5348-dirty.ts", "export const dirty = true;\n", "feat: add dirty refusal content");
      await fixture.checkout("master");
      git(rootDir, `git worktree add ${JSON.stringify(worktreePath)} ${JSON.stringify(branch)}`);
      await store.updateTask(task.id, { worktree: worktreePath, branch } as any);
      store.enqueueMergeQueue(task.id);
      git(worktreePath, "sh -c 'printf dirty > DIRTY.txt'");

      const integrationBefore = git(rootDir, "git rev-parse refs/heads/master");
      await expect(aiMergeTask(store, rootDir, task.id)).rejects.toMatchObject({
        name: "MergeHandoffRefusedError",
        gate: "working-tree-dirty",
        reason: "dirty-worktree",
      });
      const integrationAfter = git(rootDir, "git rev-parse refs/heads/master");
      expect(integrationAfter).toBe(integrationBefore);

      const refused = store.getRunAuditEvents({ taskId: task.id }).filter((event) => event.mutationType === "merge:reuse-handoff-refused");
      expect(refused).toHaveLength(1);
      expect(refused[0]?.metadata).toMatchObject({ gate: "working-tree-dirty", reason: "dirty-worktree" });
      expect(refused[0]?.metadata?.integrationBranch).toBeUndefined();
      expect(JSON.stringify(refused[0]?.metadata ?? {})).not.toContain("\"main\"");
      const latest = await store.getTask(task.id);
      expect(latest?.column).toBe("in-review");
      // aiMergeTask rethrows refusal; upstream project-engine catch maps this to status=failed.
      expect(JSON.stringify({ gate: "working-tree-dirty", reason: "dirty-worktree" })).toContain("dirty-worktree");
    } finally {
      await fixture.cleanup();
    }
  }, 30_000);

  it("Scenario C: worktrunk no longer forces cwd mode", () => {
    const root = resolveMergeIntegrationRoot({
      task: { id: "FN-5348", worktree: "/tmp/task-worktree" } as any,
      settings: { mergeIntegrationWorktree: "reuse-task-worktree", worktrunk: { enabled: true } } as any,
      projectRoot: "/tmp/project-root",
    });
    expect(root.mode).toBe("reuse-task-worktree");
  });

  it.skipIf(!hasGit)("Scenario D: explicit opt-in (legacy alias) emits warning", async () => {
    const fixture = await makeReliabilityFixture({
      taskId: "FN-5348-CWD-OPTIN",
      settings: {
        baseBranch: "master",
        mergeIntegrationWorktree: "cwd-main",
      } as any,
    });

    const warnSpy = vi.spyOn(mergerLog, "warn").mockImplementation(() => undefined as any);

    try {
      const { rootDir, store, task } = fixture;
      const actualTask = await store.getTask(task.id);
      const branch = `fusion/${actualTask!.id.toLowerCase()}`;

      git(rootDir, "git branch -m main master");
      const completedSteps = (actualTask?.steps ?? []).map((step) => ({ ...step, status: "done" as const }));
      await store.updateTask(task.id, {
        baseBranch: "master",
        branch,
        steps: completedSteps,
        currentStep: completedSteps.length,
      } as any);
      await fixture.createBranch(branch);
      await fixture.writeAndCommit("packages/engine/src/fn-5348-optin.ts", "export const optin = true;\n", "feat: add cwd opt-in merge content");
      await fixture.checkout("master");

      const result = await aiMergeTask(store, rootDir, task.id);
      expect(result.merged).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("mergeIntegrationWorktree=cwd-integration-branch is explicit opt-in"));
      const auditTypes = store.getRunAuditEvents({ taskId: task.id }).map((event) => event.mutationType);
      expect(auditTypes).not.toContain("merge:cwd-integration-fallback-removed");
    } finally {
      await fixture.cleanup();
    }
  }, 30_000);

  it.todo("Scenario E: reserved tripwire — no production emit site after Step 3; future regression would add one");

  it("Scenario E: no production code path assigns integrationRoot.mode = cwd-main", () => {
    const merger = readFileSync(new URL("../merger.ts", import.meta.url), "utf-8");
    expect(merger).not.toMatch(/^\s*integrationRoot\.mode\s*=\s*\"cwd-main\"/m);
  });
});
