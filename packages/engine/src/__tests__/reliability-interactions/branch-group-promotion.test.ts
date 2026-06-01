import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { type TaskStore } from "@fusion/core";
import { aiMergeTask } from "../../merger.js";
import { promoteBranchGroup } from "../../group-merge-coordinator.js";
import { git, hasGit, makeReliabilityFixture } from "./_helpers.js";

async function stageMergeBranch(store: TaskStore, rootDir: string, taskId: string, fileName: string): Promise<void> {
  const task = await store.getTask(taskId);
  const branch = `fusion/${taskId.toLowerCase()}`;
  const worktreePath = join(`${rootDir}-worktrees`, taskId.toLowerCase());
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

describe("FN-5830 reliability interactions: branch group promotion", () => {
  it.skipIf(!hasGit)("promotes exactly once after all members land", async () => {
    const fixture = await makeReliabilityFixture({ taskId: "FN-5830-RI-A", settings: { testMode: true, autoMerge: true } as any });
    try {
      const { rootDir, store, task } = fixture;
      const second = await store.createTask({
        id: "FN-5830-RI-B",
        title: "FN-5830-RI-B",
        description: "second member",
        column: "in-review",
        baseBranch: "main",
        branch: "fusion/fn-5830-ri-b",
        prompt: "## File Scope\n- packages/engine/src/__tests__/reliability-interactions/**/*.ts\n",
        steps: [],
      } as any);

      await stageMergeBranch(store, rootDir, task.id, "fn5830MemberA");
      await stageMergeBranch(store, rootDir, second.id, "fn5830MemberB");

      const group = store.createBranchGroup({
        sourceType: "planning",
        sourceId: "PS-FN5830-A",
        branchName: "fusion/groups/fn-5830-a",
        autoMerge: true,
      });
      await store.setTaskBranchGroup(task.id, group.id);
      await store.setTaskBranchGroup(second.id, group.id);
      await store.updateTask(task.id, { branchContext: { groupId: group.id, source: "planning", assignmentMode: "shared" } } as any);
      await store.updateTask(second.id, { branchContext: { groupId: group.id, source: "planning", assignmentMode: "shared" } } as any);

      const firstMerge = await aiMergeTask(store, rootDir, task.id);
      expect(firstMerge.merged).toBe(true);
      await store.updateTask(task.id, {
        column: "done",
        mergeDetails: { ...(await store.getTask(task.id))?.mergeDetails, mergeTargetSource: "branch-group-integration" },
      } as any);
      expect(() => git(rootDir, "git show main:packages/engine/src/fn5830MemberA.ts")).toThrow();

      const audits: Array<any> = [];
      const promoteWithMembers = async (memberIds: string[]) => promoteBranchGroup({
        store: {
          getBranchGroup: (...args: any[]) => (store as any).getBranchGroup(...args),
          updateBranchGroup: (...args: any[]) => (store as any).updateBranchGroup(...args),
          listTasksByBranchGroup: async () => Promise.all(memberIds.map(async (id) => await store.getTask(id))).then((tasks) => tasks.filter(Boolean) as any),
        } as any,
        rootDir,
        groupId: group.id,
        settings: { autoMerge: true, globalPause: false, enginePaused: false, mergeStrategy: "direct", baseBranch: "main" } as any,
        recordAudit: (e) => { audits.push(e); },
      });

      const incomplete = await promoteWithMembers([task.id, second.id]);
      expect(incomplete.reason).toBe("incomplete");

      const secondMerge = await aiMergeTask(store, rootDir, second.id);
      expect(secondMerge.merged).toBe(true);
      await store.updateTask(second.id, {
        column: "done",
        mergeDetails: { ...(await store.getTask(second.id))?.mergeDetails, mergeTargetSource: "branch-group-integration" },
      } as any);
      const promoted = await promoteWithMembers([task.id, second.id]);
      expect(promoted.reason).toBe("promoted");
      expect(git(rootDir, "git show main:packages/engine/src/fn5830MemberA.ts")).toContain("fn5830MemberA");
      expect(git(rootDir, "git show main:packages/engine/src/fn5830MemberB.ts")).toContain("fn5830MemberB");
      expect(store.getBranchGroup(group.id)?.status).toBe("finalized");
      expect(store.getBranchGroup(group.id)?.prState).toBe("merged");

      const again = await promoteWithMembers([task.id, second.id]);
      expect(again.reason).toBe("already-finalized");
      const promoteEvents = audits.filter((event) => event.mutationType === "merge:branch-group-promoted" && (event.metadata as any)?.groupId === group.id);
      expect(promoteEvents).toHaveLength(1);
    } finally {
      await fixture.cleanup();
    }
  }, 45_000);

  it.skipIf(!hasGit)("respects disabled gate and does not promote", async () => {
    const scenarios: Array<{ name: string; settings: any; groupAutoMerge?: boolean; fileName: string }> = [
      {
        name: "settings auto-merge disabled",
        settings: { testMode: true, autoMerge: false },
        groupAutoMerge: true,
        fileName: "fn5830GateSettings",
      },
      {
        name: "group auto-merge disabled",
        settings: { testMode: true, autoMerge: true },
        groupAutoMerge: false,
        fileName: "fn5830GateGroup",
      },
    ];

    for (const scenario of scenarios) {
      const fixture = await makeReliabilityFixture({ taskId: `FN-5830-RI-GATE-${scenario.fileName}`, settings: scenario.settings });
      try {
        const { rootDir, store, task } = fixture;
        await stageMergeBranch(store, rootDir, task.id, scenario.fileName);
        const group = store.createBranchGroup({
          sourceType: "planning",
          sourceId: `PS-FN5830-GATE-${scenario.fileName}`,
          branchName: `fusion/groups/fn-5830-gate-${scenario.fileName}`,
          autoMerge: scenario.groupAutoMerge,
        });
        await store.setTaskBranchGroup(task.id, group.id);
        await store.updateTask(task.id, { branchContext: { groupId: group.id, source: "planning", assignmentMode: "shared" } } as any);

        const mergeResult = await aiMergeTask(store, rootDir, task.id);
        expect(mergeResult.merged).toBe(true);
        await store.updateTask(task.id, {
          column: "done",
          mergeDetails: { ...(await store.getTask(task.id))?.mergeDetails, mergeTargetSource: "branch-group-integration" },
        } as any);
        const audits: Array<any> = [];
        const gated = await promoteBranchGroup({
          store: {
            getBranchGroup: (...args: any[]) => (store as any).getBranchGroup(...args),
            updateBranchGroup: (...args: any[]) => (store as any).updateBranchGroup(...args),
            listTasksByBranchGroup: async () => [await store.getTask(task.id)].filter(Boolean) as any,
          } as any,
          rootDir,
          groupId: group.id,
          settings: await store.getSettings() as any,
          recordAudit: (e) => { audits.push(e); },
        });
        expect(gated.reason, scenario.name).toBe("gated");
        expect(() => git(rootDir, `git show main:packages/engine/src/${scenario.fileName}.ts`), scenario.name).toThrow();
        expect(store.getBranchGroup(group.id)?.status, scenario.name).toBe("open");
        expect(store.getBranchGroup(group.id)?.prState, scenario.name).toBe("none");
        expect(audits.find((event) => event.mutationType === "merge:branch-group-promotion-gated" && (event.metadata as any)?.groupId === group.id), scenario.name).toBeTruthy();
      } finally {
        await fixture.cleanup();
      }
    }
  }, 45_000);
});
