import { describe, expect, it, vi } from "vitest";
import type { MissionFeature, TaskStore } from "@fusion/core";
import { Scheduler } from "../../scheduler.js";

function createTaskStore(tasks: any[] = []): TaskStore {
  return {
    listTasks: vi.fn(async () => tasks),
    getTask: vi.fn(async (taskId: string) => tasks.find((task) => task.id === taskId)),
    recordRunAuditEvent: vi.fn(async () => undefined),
    getSettings: vi.fn(async () => ({})),
    getRootDir: vi.fn(() => "/test/project"),
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as TaskStore;
}

function feature(overrides: Partial<MissionFeature>): MissionFeature {
  return {
    id: "F-001",
    sliceId: "SL-001",
    title: "Feature one",
    status: "defined",
    loopState: "idle",
    implementationAttemptCount: 0,
    validatorAttemptCount: 0,
    taskId: undefined,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as MissionFeature;
}

describe("FN-5754 reliability: mission stranded feature retriage", () => {
  it("triages stranded features in active autopilot slices and is idempotent", async () => {
    const features = [feature({ id: "F-001" })];
    const tasks: any[] = [];
    const missionStore = {
      listMissions: vi.fn(() => [{ id: "M-001", status: "active", autopilotEnabled: true }]),
      getMissionWithHierarchy: vi.fn(() => ({
        id: "M-001",
        status: "active",
        milestones: [{ id: "MS-001", slices: [{ id: "SL-001", status: "active", features }] }],
      })),
      triageFeature: vi.fn(async (featureId: string) => {
        const taskId = `FN-${featureId}`;
        tasks.push({ id: taskId, title: "Feature one", missionId: "M-001", sliceId: "SL-001", column: "todo", status: "queued" });
        features[0] = { ...features[0], taskId, status: "triaged" };
        return features[0];
      }),
      linkFeatureToTask: vi.fn(),
      updateFeatureStatus: vi.fn(),
      listAssertionsForFeature: vi.fn(() => []),
    };
    const store = createTaskStore(tasks);

    const scheduler = new Scheduler(store, { missionStore: missionStore as any });
    await scheduler.reconcileAllMissionFeatures();
    await scheduler.reconcileAllMissionFeatures();

    expect(missionStore.triageFeature).toHaveBeenCalledTimes(1);
    expect(features[0].taskId).toBe("FN-F-001");
  });

  it("links title-matched existing tasks without recreating", async () => {
    const tasks = [{ id: "FN-001", title: "Feature one", missionId: "M-001", sliceId: "SL-001", column: "todo", status: "queued" }];
    const features = [feature({ id: "F-001", taskId: undefined, status: "triaged" })];
    const missionStore = {
      listMissions: vi.fn(() => [{ id: "M-001", status: "active", autopilotEnabled: true }]),
      getMissionWithHierarchy: vi.fn(() => ({
        id: "M-001",
        status: "active",
        milestones: [{ id: "MS-001", slices: [{ id: "SL-001", status: "active", features }] }],
      })),
      triageFeature: vi.fn(),
      linkFeatureToTask: vi.fn((featureId: string, taskId: string) => {
        features[0] = { ...features[0], id: featureId, taskId };
        return features[0];
      }),
      updateFeatureStatus: vi.fn(),
      listAssertionsForFeature: vi.fn(() => []),
    };

    const scheduler = new Scheduler(createTaskStore(tasks), { missionStore: missionStore as any });
    await scheduler.reconcileAllMissionFeatures();

    expect(missionStore.linkFeatureToTask).toHaveBeenCalledWith("F-001", "FN-001");
    expect(missionStore.triageFeature).not.toHaveBeenCalled();
  });

  it("skips inconsistent non-defined stranded features without title match", async () => {
    const features = [feature({ id: "F-001", status: "triaged", taskId: undefined })];
    const missionStore = {
      listMissions: vi.fn(() => [{ id: "M-001", status: "active", autopilotEnabled: true }]),
      getMissionWithHierarchy: vi.fn(() => ({
        id: "M-001",
        status: "active",
        milestones: [{ id: "MS-001", slices: [{ id: "SL-001", status: "active", features }] }],
      })),
      triageFeature: vi.fn(),
      linkFeatureToTask: vi.fn(),
      updateFeatureStatus: vi.fn(),
    };

    const scheduler = new Scheduler(createTaskStore([]), { missionStore: missionStore as any });
    await scheduler.reconcileAllMissionFeatures();

    expect(missionStore.triageFeature).not.toHaveBeenCalled();
    expect(missionStore.linkFeatureToTask).not.toHaveBeenCalled();
  });

  it("leaves non-autopilot and blocked features untouched", async () => {
    const autopilotOffFeature = feature({ id: "F-001", status: "defined", taskId: undefined });
    const blockedFeature = feature({ id: "F-002", status: "blocked", taskId: undefined, title: "Blocked feature" });
    const missionStore = {
      listMissions: vi.fn(() => [
        { id: "M-001", status: "active", autopilotEnabled: false, autoAdvance: false },
        { id: "M-002", status: "active", autopilotEnabled: true },
      ]),
      getMissionWithHierarchy: vi.fn((missionId: string) => missionId === "M-001"
        ? { id: missionId, status: "active", milestones: [{ id: "MS-001", slices: [{ id: "SL-001", status: "active", features: [autopilotOffFeature] }] }] }
        : { id: missionId, status: "active", milestones: [{ id: "MS-002", slices: [{ id: "SL-002", status: "active", features: [blockedFeature] }] }] }),
      triageFeature: vi.fn(),
      linkFeatureToTask: vi.fn(),
      updateFeatureStatus: vi.fn(),
    };

    const scheduler = new Scheduler(createTaskStore([]), { missionStore: missionStore as any });
    await scheduler.reconcileAllMissionFeatures();

    expect(missionStore.triageFeature).not.toHaveBeenCalled();
    expect(missionStore.linkFeatureToTask).not.toHaveBeenCalled();
  });

  it("emits mission:stranded-feature-triaged audit entries", async () => {
    const features = [feature({ id: "F-001" })];
    const tasks: any[] = [];
    const store = createTaskStore(tasks);
    const missionStore = {
      listMissions: vi.fn(() => [{ id: "M-001", status: "active", autopilotEnabled: true }]),
      getMissionWithHierarchy: vi.fn(() => ({
        id: "M-001",
        status: "active",
        milestones: [{ id: "MS-001", slices: [{ id: "SL-001", status: "active", features }] }],
      })),
      triageFeature: vi.fn(async () => {
        features[0] = { ...features[0], taskId: "FN-001", status: "triaged" };
        tasks.push({ id: "FN-001", title: "Feature one", missionId: "M-001", sliceId: "SL-001", column: "todo", status: "queued" });
        return features[0];
      }),
      linkFeatureToTask: vi.fn(),
      updateFeatureStatus: vi.fn(),
      listAssertionsForFeature: vi.fn(() => []),
    };

    const scheduler = new Scheduler(store, { missionStore: missionStore as any });
    await scheduler.reconcileAllMissionFeatures();

    expect((store.recordRunAuditEvent as any).mock.calls.some(([event]: any[]) => event.mutationType === "mission:stranded-feature-triaged" && event.metadata?.featureId === "F-001" && event.metadata?.taskId === "FN-001")).toBe(true);
  });
});
