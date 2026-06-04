import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { type TaskStore } from "@fusion/core";
import { aiMergeTask } from "../../merger.js";
import { git, hasGit, makeReliabilityFixture } from "./_helpers.js";

async function stageMergeBranch(store: TaskStore, rootDir: string, taskId: string, fileName: string): Promise<void> {
  const task = await store.getTask(taskId);
  const branch = `fusion/${taskId.toLowerCase()}`;
  const worktreeRoot = `${rootDir}-worktrees`;
  const worktreePath = join(worktreeRoot, taskId.toLowerCase());

  await store.updateTask(taskId, {
    baseBranch: "",
    branch,
    column: "in-review",
    worktree: worktreePath,
    steps: (task?.steps ?? []).map((step) => ({ ...step, status: "done" as const })),
    currentStep: (task?.steps ?? []).length ?? 0,
  } as any);

  git(rootDir, `git checkout -b ${branch}`);
  await mkdir(join(rootDir, "packages/engine/src"), { recursive: true });
  git(rootDir, `sh -c 'printf ${JSON.stringify(`export const ${fileName} = true;\n`)} > ${JSON.stringify(`packages/engine/src/${fileName}.ts`)}'`);
  git(rootDir, `git add ${JSON.stringify(`packages/engine/src/${fileName}.ts`)}`);
  git(rootDir, `git commit -m ${JSON.stringify(`feat: add ${fileName}`)}`);
  git(rootDir, "git checkout main");
  store.enqueueMergeQueue(taskId);
}

describe("FN-5782 reliability interactions: branch group merge routing", () => {
  it.skipIf(!hasGit)("routes shared grouped members to branch group integration branch and emits audit", async () => {
    const fixture = await makeReliabilityFixture({ taskId: "FN-5782-RI-SHARED", settings: { testMode: true } as any });

    try {
      const { rootDir, store, task } = fixture;
      await stageMergeBranch(store, rootDir, task.id, "fn5782Shared");

      const group = store.createBranchGroup({
        sourceType: "planning",
        sourceId: "PS-FN5782",
        branchName: "fusion/groups/fn-5782-shared",
      });
      await store.setTaskBranchGroup(task.id, group.id);
      const beforeUpdateAt = store.getBranchGroup(group.id)!.updatedAt;

      const auditSpy = vi.spyOn(store as any, "recordRunAuditEvent");
      const result = await aiMergeTask(store, rootDir, task.id);
      expect(result.merged).toBe(true);

      expect(git(rootDir, `git show ${group.branchName}:packages/engine/src/fn5782Shared.ts`)).toContain("fn5782Shared");
      expect(() => git(rootDir, "git show main:packages/engine/src/fn5782Shared.ts")).toThrow();

      const updatedGroup = store.getBranchGroup(group.id)!;
      expect(updatedGroup.status).toBe("open");
      expect(updatedGroup.updatedAt).toBeGreaterThanOrEqual(beforeUpdateAt);
      expect(updatedGroup.worktreePath).toBe(join(`${rootDir}-worktrees`, task.id.toLowerCase()));

      expect(auditSpy).toHaveBeenCalledWith(expect.objectContaining({
        domain: "git",
        mutationType: "merge:branch-group-routed",
        target: task.id,
        metadata: expect.objectContaining({
          groupId: group.id,
          branchName: group.branchName,
          mergeTargetBranch: group.branchName,
          mergeTargetSource: "branch-group-integration",
        }),
      }));
    } finally {
      await fixture.cleanup();
    }
  }, 30_000);

  it.skipIf(!hasGit)("records shared-member landing even when autoMerge is false", async () => {
    const fixture = await makeReliabilityFixture({
      taskId: "FN-5819-RI-AUTO-OFF",
      settings: { testMode: true, autoMerge: false } as any,
    });

    try {
      const { rootDir, store, task } = fixture;
      await stageMergeBranch(store, rootDir, task.id, "fn5819AutoOff");

      const group = store.createBranchGroup({
        sourceType: "planning",
        sourceId: "PS-FN5819",
        branchName: "fusion/groups/fn-5819-auto-off",
      });
      await store.setTaskBranchGroup(task.id, group.id);

      const result = await aiMergeTask(store, rootDir, task.id);
      expect(result.merged).toBe(true);
      expect(git(rootDir, `git show ${group.branchName}:packages/engine/src/fn5819AutoOff.ts`)).toContain("fn5819AutoOff");
      expect(() => git(rootDir, "git show main:packages/engine/src/fn5819AutoOff.ts")).toThrow();

      const updatedGroup = store.getBranchGroup(group.id)!;
      expect(updatedGroup.status).toBe("open");
      expect(updatedGroup.worktreePath).toBe(join(`${rootDir}-worktrees`, task.id.toLowerCase()));

      const events = store.getRunAuditEvents().filter((event) => event.target === task.id);
      expect(events).toEqual(expect.arrayContaining([
        expect.objectContaining({
          mutationType: "merge:branch-group-routed",
          metadata: expect.objectContaining({
            mergeTargetBranch: group.branchName,
            mergeTargetSource: "branch-group-integration",
          }),
        }),
        expect.objectContaining({
          mutationType: "merge:branch-group-promotion-gated",
          metadata: expect.objectContaining({
            groupId: group.id,
            effectiveEligible: false,
          }),
        }),
      ]));
    } finally {
      await fixture.cleanup();
    }
  }, 45_000);
});
