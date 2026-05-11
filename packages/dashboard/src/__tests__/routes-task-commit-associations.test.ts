import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import type { Task, TaskCommitAssociation } from "@fusion/core";
import { createServer } from "../server.js";

class MockStore extends EventEmitter {
  private tasks = new Map<string, Task>();
  private associations = new Map<string, TaskCommitAssociation[]>();

  getRootDir(): string {
    return "/tmp/fn-3998";
  }

  getFusionDir(): string {
    return "/tmp/fn-3998/.fusion";
  }

  getDatabase() {
    return {
      exec: () => undefined,
      prepare: () => ({ run: () => ({ changes: 0 }), get: () => undefined, all: () => [] }),
    };
  }

  getMissionStore() {
    return {
      listMissions: async () => [],
      createMission: () => undefined,
      getMission: () => undefined,
      updateMission: () => undefined,
      deleteMission: () => undefined,
      listTemplates: async () => [],
      createTemplate: () => undefined,
      getTemplate: () => undefined,
      updateTemplate: () => undefined,
      deleteTemplate: () => undefined,
      instantiateMission: () => undefined,
    };
  }

  async listTasks(): Promise<Task[]> {
    return Array.from(this.tasks.values());
  }

  getTask(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  addTask(task: Task): void {
    this.tasks.set(task.id, task);
  }

  setAssociations(lineageId: string, rows: TaskCommitAssociation[]): void {
    this.associations.set(lineageId, rows);
  }

  async getTaskCommitAssociationsByLineageId(lineageId: string): Promise<TaskCommitAssociation[]> {
    return this.associations.get(lineageId) ?? [];
  }
}

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "FN-3998",
    title: "Lineage task",
    description: "Test",
    column: "done",
    dependencies: [],
    steps: [],
    currentStep: 0,
    log: [],
    createdAt: "2026-05-11T00:00:00.000Z",
    updatedAt: "2026-05-11T00:00:00.000Z",
    columnMovedAt: "2026-05-11T00:00:00.000Z",
    lineageId: "lineage-1",
    ...overrides,
  };
}

async function getCommitAssociations(
  app: Parameters<typeof import("../test-request.js").get>[0],
  taskId: string,
): Promise<{ status: number; body: any }> {
  const { get } = await import("../test-request.js");
  return get(app, `/api/tasks/${taskId}/commit-associations`);
}

describe("GET /api/tasks/:id/commit-associations", () => {
  it("returns 404 when task is unknown", async () => {
    const app = createServer(new MockStore() as any);
    const response = await getCommitAssociations(app, "FN-UNKNOWN");
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Task not found" });
  });

  it("returns lineage associations for a known task", async () => {
    const store = new MockStore();
    store.addTask(createTask({ id: "FN-2000", lineageId: "lineage-2000" }));
    store.setAssociations("lineage-2000", [
      {
        id: "assoc-1",
        taskLineageId: "lineage-2000",
        taskIdSnapshot: "FN-2000",
        commitSha: "abc1234def",
        commitSubject: "feat(FN-2000): add lineage API",
        authoredAt: "2026-05-11T02:00:00.000Z",
        matchedBy: "canonical-lineage-trailer",
        confidence: "canonical",
        note: "primary commit",
        createdAt: "2026-05-11T02:01:00.000Z",
        updatedAt: "2026-05-11T02:01:00.000Z",
      },
    ]);

    const app = createServer(store as any);
    const response = await getCommitAssociations(app, "FN-2000");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      taskId: "FN-2000",
      lineageId: "lineage-2000",
      associations: [
        {
          commitSha: "abc1234def",
          commitSubject: "feat(FN-2000): add lineage API",
          authoredAt: "2026-05-11T02:00:00.000Z",
          matchedBy: "canonical-lineage-trailer",
          confidence: "canonical",
          taskIdSnapshot: "FN-2000",
          note: "primary commit",
        },
      ],
    });
  });

  it("returns empty associations for known task with no rows", async () => {
    const store = new MockStore();
    store.addTask(createTask({ id: "FN-2001", lineageId: "lineage-2001" }));
    const app = createServer(store as any);

    const response = await getCommitAssociations(app, "FN-2001");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      taskId: "FN-2001",
      lineageId: "lineage-2001",
      associations: [],
    });
  });
});
