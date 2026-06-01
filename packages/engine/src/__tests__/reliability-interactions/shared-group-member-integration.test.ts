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
}

describe("FN-5819 reliability interactions: shared group member integration", () => {
  it.skipIf(!hasGit)("keeps shared-member integration forward under autoMerge false", async () => {
    const fixture = await makeReliabilityFixture({
      taskId: "FN-5819-RI-A",
      settings: { testMode: true, autoMerge: false } as any,
    });

    try {
      const { rootDir, store, task, manager } = fixture;
      const second = await store.createTask({
        id: "FN-5819-RI-B",
        title: "FN-5819-RI-B",
        description: "second member",
        column: "in-review",
        baseBranch: "main",
        branch: "fusion/fn-5819-ri-b",
        prompt: "## File Scope\n- packages/engine/src/__tests__/reliability-interactions/**/*.ts\n",
        steps: [],
      } as any);
      const nongroup = await store.createTask({
        id: "FN-5819-RI-NONGROUP",
        title: "FN-5819-RI-NONGROUP",
        description: "non-group in-review",
        column: "in-review",
        baseBranch: "main",
        branch: "fusion/fn-5819-ri-nongroup",
        prompt: "## File Scope\n- packages/engine/src/__tests__/reliability-interactions/**/*.ts\n",
        steps: [],
      } as any);

      const group = store.createBranchGroup({
        sourceType: "planning",
        sourceId: "PS-FN5819",
        branchName: "fusion/groups/fn-5819-shared",
      });
      await store.setTaskBranchGroup(task.id, group.id);
      await store.setTaskBranchGroup(second.id, group.id);

      await stageMergeBranch(store, rootDir, task.id, "fn5819MemberA");
      await stageMergeBranch(store, rootDir, second.id, "fn5819MemberB");

      const first = await aiMergeTask(store, rootDir, task.id);
      const secondResult = await aiMergeTask(store, rootDir, second.id);
      expect(first.merged).toBe(true);
      expect(secondResult.merged).toBe(true);

      expect(git(rootDir, `git show ${group.branchName}:packages/engine/src/fn5819MemberA.ts`)).toContain("fn5819MemberA");
      expect(git(rootDir, `git show ${group.branchName}:packages/engine/src/fn5819MemberB.ts`)).toContain("fn5819MemberB");
      expect(() => git(rootDir, "git show main:packages/engine/src/fn5819MemberA.ts")).toThrow();
      expect(() => git(rootDir, "git show main:packages/engine/src/fn5819MemberB.ts")).toThrow();

      const moveSpy = vi.spyOn(store, "moveTask");
      await (manager as any).runMaintenance();

      expect(moveSpy.mock.calls.some(([id, column]) => id === task.id && column === "todo")).toBe(false);
      expect(moveSpy.mock.calls.some(([id, column]) => id === second.id && column === "todo")).toBe(false);
      expect(moveSpy.mock.calls.some(([id, column]) => id === task.id && column === "in-progress")).toBe(false);
      expect(moveSpy.mock.calls.some(([id, column]) => id === second.id && column === "in-progress")).toBe(false);

      const refreshedNonGroup = await store.getTask(nongroup.id);
      expect(refreshedNonGroup.column).toBe("in-review");
    } finally {
      await fixture.cleanup();
    }
  }, 60_000);
});
