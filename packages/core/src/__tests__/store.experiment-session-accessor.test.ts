import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { ExperimentSessionStore } from "../experiment-session-store.js";
import { createTaskStoreTestHarness } from "./store-test-helpers.js";

describe("TaskStore getExperimentSessionStore", () => {
  const harness = createTaskStoreTestHarness();

  beforeEach(harness.beforeEach);
  afterEach(harness.afterEach);

  it("returns an ExperimentSessionStore instance", () => {
    const accessorStore = harness.store().getExperimentSessionStore();
    expect(accessorStore).toBeInstanceOf(ExperimentSessionStore);
  });

  it("returns the same cached instance across calls", () => {
    const store = harness.store();
    const first = store.getExperimentSessionStore();
    const second = store.getExperimentSessionStore();
    expect(second).toBe(first);
  });

  it("uses the same project database backing storage", () => {
    const taskStore = harness.store();
    const accessorStore = taskStore.getExperimentSessionStore();

    accessorStore.createSession({
      name: "session-from-accessor",
      metric: { name: "latency", direction: "minimize" },
    });

    const directStore = new ExperimentSessionStore(taskStore.getDatabase());
    const sessions = directStore.listSessions();

    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.name).toBe("session-from-accessor");
  });

  it("does not initialize research store when experiment accessor is called", () => {
    const taskStore = harness.store() as unknown as {
      getExperimentSessionStore: () => ExperimentSessionStore;
      getResearchStore: () => unknown;
      experimentSessionStore: ExperimentSessionStore | null;
      researchStore: unknown;
    };

    expect(taskStore.researchStore).toBeNull();
    expect(taskStore.experimentSessionStore).toBeNull();

    taskStore.getExperimentSessionStore();

    expect(taskStore.experimentSessionStore).toBeInstanceOf(ExperimentSessionStore);
    expect(taskStore.researchStore).toBeNull();

    const research = taskStore.getResearchStore();
    expect(research).toBeTruthy();
  });
});
