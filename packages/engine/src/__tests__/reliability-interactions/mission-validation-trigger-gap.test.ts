import { describe, expect, it, vi } from "vitest";
import type { MissionFeature, MissionStore, TaskStore } from "@fusion/core";
import { Scheduler } from "../../scheduler.js";
import { MissionExecutionLoop } from "../../mission-execution-loop.js";

function makeTaskStore(taskColumn: "done" | "archived" | "in-progress" = "done") {
  return {
    getTask: vi.fn(async (taskId: string) => ({
      id: taskId,
      title: "Mission task",
      description: "desc",
      column: taskColumn,
      status: taskColumn === "in-progress" ? "in-progress" : "done",
      sliceId: "SL-001",
      log: [],
    })),
    getRootDir: vi.fn(() => "/test/project"),
    getSettings: vi.fn(async () => ({})),
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as TaskStore;
}

function makeFeature(overrides: Partial<MissionFeature> = {}): MissionFeature {
  return {
    id: "F-001",
    sliceId: "SL-001",
    title: "Feature",
    status: "in-progress",
    loopState: "implementing",
    implementationAttemptCount: 0,
    validatorAttemptCount: 0,
    taskId: "FN-001",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("FN-5715 reliability: mission validation trigger gap", () => {
  it("starts mission loop + processes completion when done task lands while loop is stopped", async () => {
    const feature = makeFeature();
    const missionStore = {
      getFeatureByTaskId: vi.fn(() => feature),
      listAssertionsForFeature: vi.fn(() => [{ id: "CA-1" }]),
      updateFeatureStatus: vi.fn(),
      getSlice: vi.fn(() => ({ id: "SL-001", milestoneId: "MS-001", status: "active" })),
      getMilestone: vi.fn(() => ({ id: "MS-001", missionId: "M-001" })),
    } as unknown as MissionStore;
    const missionExecutionLoop = {
      isRunning: vi.fn(() => false),
      start: vi.fn(),
      processTaskOutcome: vi.fn(async () => undefined),
    };

    const scheduler = new Scheduler(makeTaskStore("done"), {
      missionStore,
      missionExecutionLoop: missionExecutionLoop as any,
    });

    await (scheduler as any).handleMissionTaskMove("FN-001", "done");

    expect(missionExecutionLoop.start).toHaveBeenCalledTimes(1);
    expect(missionExecutionLoop.processTaskOutcome).toHaveBeenCalledWith("FN-001");
    expect(missionStore.updateFeatureStatus).not.toHaveBeenCalledWith("F-001", "done");
  });

  it("keeps no-assertion completion path unchanged", async () => {
    const feature = makeFeature();
    const missionStore = {
      getFeatureByTaskId: vi.fn(() => feature),
      listAssertionsForFeature: vi.fn(() => []),
      updateFeatureStatus: vi.fn(),
      getSlice: vi.fn(() => ({ id: "SL-001", milestoneId: "MS-001", status: "active" })),
      getMilestone: vi.fn(() => ({ id: "MS-001", missionId: "M-001" })),
    } as unknown as MissionStore;

    const scheduler = new Scheduler(makeTaskStore("done"), {
      missionStore,
      missionExecutionLoop: {
        isRunning: vi.fn(() => true),
        start: vi.fn(),
        processTaskOutcome: vi.fn(async () => undefined),
      } as any,
    });

    await (scheduler as any).handleMissionTaskMove("FN-001", "done");

    expect(missionStore.updateFeatureStatus).toHaveBeenCalledWith("F-001", "done");
  });

  it("recovers implementing features whose task is already done at startup", async () => {
    const feature = makeFeature({ status: "done", lastValidatorStatus: undefined });
    const missionStore = {
      listMissions: vi.fn(() => [{ id: "M-001", status: "active" }]),
      getMissionWithHierarchy: vi.fn(() => ({
        id: "M-001",
        status: "active",
        milestones: [{ status: "active", slices: [{ status: "active", features: [feature] }] }],
      })),
      listAssertionsForFeature: vi.fn(() => [{ id: "CA-1" }]),
      transitionLoopState: vi.fn(),
    };
    const taskStore = {
      getTask: vi.fn(async () => ({ id: "FN-001", column: "done" })),
    };

    const loop = new MissionExecutionLoop({
      missionStore: missionStore as any,
      taskStore: taskStore as any,
      rootDir: process.cwd(),
    });
    const processSpy = vi.spyOn(loop, "processTaskOutcome").mockResolvedValue(undefined);
    loop.start();

    await loop.recoverActiveMissions();

    expect(processSpy).toHaveBeenCalledWith("FN-001");
    loop.stop();
  });

  it("is idempotent for already-passed implementing features", async () => {
    const feature = makeFeature({ status: "done", lastValidatorStatus: "passed" });
    const missionStore = {
      listMissions: vi.fn(() => [{ id: "M-001", status: "active" }]),
      getMissionWithHierarchy: vi.fn(() => ({
        id: "M-001",
        status: "active",
        milestones: [{ status: "active", slices: [{ status: "active", features: [feature] }] }],
      })),
      listAssertionsForFeature: vi.fn(() => [{ id: "CA-1" }]),
      transitionLoopState: vi.fn(),
    };
    const taskStore = {
      getTask: vi.fn(async () => ({ id: "FN-001", column: "done" })),
    };

    const loop = new MissionExecutionLoop({
      missionStore: missionStore as any,
      taskStore: taskStore as any,
      rootDir: process.cwd(),
    });
    const processSpy = vi.spyOn(loop, "processTaskOutcome").mockResolvedValue(undefined);
    loop.start();

    await loop.recoverActiveMissions();

    expect(processSpy).not.toHaveBeenCalled();
    loop.stop();
  });
});
