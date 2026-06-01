import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it, afterEach } from "vitest";
import {
  evaluateBranchGroupCompletion,
  evaluateBranchGroupPromotion,
  promoteBranchGroup,
  resolveBranchGroupMergeRouting,
} from "../group-merge-coordinator.js";

const dirs: string[] = [];

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "fusion-group-route-"));
  dirs.push(dir);
  execSync("git init -b main", { cwd: dir, stdio: "ignore" });
  execSync("git config user.name test", { cwd: dir });
  execSync("git config user.email test@example.com", { cwd: dir });
  execSync("echo hi > a.txt", { cwd: dir, shell: "/bin/bash" });
  execSync("git add . && git commit -m init", { cwd: dir, stdio: "ignore", shell: "/bin/bash" });
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("evaluateBranchGroupCompletion", () => {
  it("returns complete when all members are landed", () => {
    const result = evaluateBranchGroupCompletion({
      members: [
        { id: "FN-A", column: "done" as const },
        { id: "FN-B", column: "in-review" as const, mergeDetails: { mergeTargetSource: "branch-group-integration" } as any },
      ] as any,
    });

    expect(result).toEqual({
      complete: true,
      totalMembers: 2,
      landedMemberIds: ["FN-A", "FN-B"],
      pendingMemberIds: [],
    });
  });

  it("returns pending ids when one member is not landed", () => {
    const result = evaluateBranchGroupCompletion({
      members: [
        { id: "FN-A", column: "done" as const },
        { id: "FN-B", column: "todo" as const },
      ] as any,
    });

    expect(result.complete).toBe(false);
    expect(result.landedMemberIds).toEqual(["FN-A"]);
    expect(result.pendingMemberIds).toEqual(["FN-B"]);
  });

  it("treats empty groups as incomplete", () => {
    const result = evaluateBranchGroupCompletion({ members: [] });
    expect(result).toEqual({
      complete: false,
      totalMembers: 0,
      landedMemberIds: [],
      pendingMemberIds: [],
    });
  });

  it("counts mixed done + landed in-review members as complete", () => {
    const result = evaluateBranchGroupCompletion({
      members: [
        { id: "FN-A", column: "done" as const },
        { id: "FN-B", column: "in-review" as const, mergeDetails: { mergeTargetSource: "branch-group-integration" } as any },
      ] as any,
    });

    expect(result.complete).toBe(true);
    expect(result.pendingMemberIds).toEqual([]);
  });
});

describe("evaluateBranchGroupPromotion", () => {
  const baseGroup = {
    id: "BG-1",
    branchName: "fusion/groups/planning-x",
    autoMerge: true,
    status: "open" as const,
  };

  const baseSettings: {
    autoMerge: boolean;
    globalPause: boolean;
    enginePaused: boolean;
  } = {
    autoMerge: true,
    globalPause: false,
    enginePaused: false,
  };

  it("returns eligible when pauses are off and automerge resolves true", () => {
    const decision = evaluateBranchGroupPromotion({
      group: baseGroup,
      settings: baseSettings,
    });

    expect(decision).toEqual({
      eligible: true,
      reason: "eligible",
      groupAutoMerge: true,
    });
  });

  it("returns group-automerge-disabled when group autoMerge is false", () => {
    const decision = evaluateBranchGroupPromotion({
      group: { ...baseGroup, autoMerge: false },
      settings: baseSettings,
    });

    expect(decision).toEqual({
      eligible: false,
      reason: "group-automerge-disabled",
      groupAutoMerge: false,
    });
  });

  it("returns settings-automerge-disabled when settings autoMerge is false", () => {
    const withDefaultedGroup = evaluateBranchGroupPromotion({
      group: { ...baseGroup, autoMerge: undefined as unknown as boolean },
      settings: { ...baseSettings, autoMerge: false },
    });
    expect(withDefaultedGroup).toEqual({
      eligible: false,
      reason: "settings-automerge-disabled",
      groupAutoMerge: false,
    });

    const withExplicitGroupTrue = evaluateBranchGroupPromotion({
      group: { ...baseGroup, autoMerge: true },
      settings: { ...baseSettings, autoMerge: false },
    });
    expect(withExplicitGroupTrue).toEqual({
      eligible: false,
      reason: "settings-automerge-disabled",
      groupAutoMerge: true,
    });
  });

  it("returns global-pause before other gates", () => {
    const decision = evaluateBranchGroupPromotion({
      group: { ...baseGroup, autoMerge: true },
      settings: { ...baseSettings, globalPause: true, autoMerge: false },
    });

    expect(decision).toEqual({
      eligible: false,
      reason: "global-pause",
      groupAutoMerge: true,
    });
  });

  it("returns engine-paused before automerge gate when global pause is off", () => {
    const decision = evaluateBranchGroupPromotion({
      group: { ...baseGroup, autoMerge: true },
      settings: { ...baseSettings, enginePaused: true, autoMerge: false },
    });

    expect(decision).toEqual({
      eligible: false,
      reason: "engine-paused",
      groupAutoMerge: true,
    });
  });
});

describe("promoteBranchGroup", () => {
  function makeGroup(overrides?: Partial<any>) {
    return {
      id: "BG-1",
      sourceType: "planning",
      sourceId: "planning:x",
      branchName: "fusion/groups/planning-x",
      autoMerge: true,
      prState: "none",
      status: "open",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...overrides,
    };
  }

  it("returns incomplete without merging when members are pending", async () => {
    const rootDir = makeRepo();
    const group = makeGroup();
    const result = await promoteBranchGroup({
      rootDir,
      groupId: group.id,
      settings: { autoMerge: true, globalPause: false, enginePaused: false, mergeStrategy: "direct", baseBranch: "main" },
      store: {
        getBranchGroup: () => group,
        listTasksByBranchGroup: async () => [{ id: "FN-A", column: "todo" }],
        updateBranchGroup: () => {
          throw new Error("should not update");
        },
      } as any,
    });

    expect(result.reason).toBe("incomplete");
    expect(() => execSync("git show main:group.txt", { cwd: rootDir })).toThrow();
  });

  it("returns gated and emits audit when promotion gates are disabled", async () => {
    const rootDir = makeRepo();
    const group = makeGroup({ autoMerge: false });
    const audits: Array<Record<string, unknown>> = [];
    const result = await promoteBranchGroup({
      rootDir,
      groupId: group.id,
      settings: { autoMerge: true, globalPause: false, enginePaused: false, mergeStrategy: "direct", baseBranch: "main" },
      recordAudit: async (event) => { audits.push(event as Record<string, unknown>); },
      store: {
        getBranchGroup: () => group,
        listTasksByBranchGroup: async () => [{ id: "FN-A", column: "done" }],
        updateBranchGroup: () => {
          throw new Error("should not update");
        },
      } as any,
    });

    expect(result.reason).toBe("gated");
    expect(audits).toEqual(expect.arrayContaining([
      expect.objectContaining({ mutationType: "merge:branch-group-promotion-gated" }),
    ]));
  });

  it("merges group branch once and finalizes group when complete and eligible", async () => {
    const rootDir = makeRepo();
    execSync("git checkout -b fusion/groups/planning-x", { cwd: rootDir });
    execSync("echo promoted > group.txt", { cwd: rootDir, shell: "/bin/bash" });
    execSync("git add group.txt && git commit -m group", { cwd: rootDir, shell: "/bin/bash" });
    execSync("git checkout main", { cwd: rootDir });

    let group = makeGroup();
    const audits: Array<Record<string, unknown>> = [];
    const first = await promoteBranchGroup({
      rootDir,
      groupId: group.id,
      settings: { autoMerge: true, globalPause: false, enginePaused: false, mergeStrategy: "direct", baseBranch: "main" },
      recordAudit: async (event) => { audits.push(event as Record<string, unknown>); },
      store: {
        getBranchGroup: () => group,
        listTasksByBranchGroup: async () => [{ id: "FN-A", column: "done" }],
        updateBranchGroup: (_id: string, patch: Partial<typeof group>) => {
          group = { ...group, ...patch };
          return group;
        },
      } as any,
    });

    expect(first.promoted).toBe(true);
    expect(first.reason).toBe("promoted");
    expect(group.status).toBe("finalized");
    expect(group.prState).toBe("merged");
    expect(execSync("git show main:group.txt", { cwd: rootDir, encoding: "utf8" })).toContain("promoted");

    const second = await promoteBranchGroup({
      rootDir,
      groupId: group.id,
      settings: { autoMerge: true, globalPause: false, enginePaused: false, mergeStrategy: "direct", baseBranch: "main" },
      recordAudit: async (event) => { audits.push(event as Record<string, unknown>); },
      store: {
        getBranchGroup: () => group,
        listTasksByBranchGroup: async () => [{ id: "FN-A", column: "done" }],
        updateBranchGroup: (_id: string, patch: Partial<typeof group>) => {
          group = { ...group, ...patch };
          return group;
        },
      } as any,
    });

    expect(second.reason).toBe("already-finalized");
    expect(audits.filter((event) => event.mutationType === "merge:branch-group-promoted")).toHaveLength(1);
  });
});

describe("resolveBranchGroupMergeRouting", () => {
  it("returns null for non-shared tasks", async () => {
    const routing = await resolveBranchGroupMergeRouting({
      task: { branchContext: { groupId: "BG-1", source: "planning", assignmentMode: "per-task-derived" } },
      store: { getBranchGroup: () => null } as any,
      projectDefaultBranch: "main",
    });
    expect(routing).toBeNull();
  });

  it("creates the group branch when missing", async () => {
    const rootDir = makeRepo();
    const branchGroup = {
      id: "BG-1",
      sourceType: "planning",
      sourceId: "planning:x",
      branchName: "fusion/groups/planning-x",
      autoMerge: false,
      prState: "none",
      status: "open",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const routing = await resolveBranchGroupMergeRouting({
      task: { branchContext: { groupId: "BG-1", source: "planning", assignmentMode: "shared" } },
      store: { getBranchGroup: () => branchGroup } as any,
      projectDefaultBranch: "main",
      rootDir,
    });

    expect(routing?.mergeTarget.branch).toBe(branchGroup.branchName);
    const branch = execSync(`git rev-parse --verify refs/heads/${branchGroup.branchName}`, { cwd: rootDir, encoding: "utf8" }).trim();
    expect(branch).toMatch(/^[a-f0-9]{40}$/);
  });
});
