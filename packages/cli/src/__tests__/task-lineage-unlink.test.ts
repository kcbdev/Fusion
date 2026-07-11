import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { TaskStore } from "@fusion/core";
import kbExtension, { closeCachedStores } from "../extension.js";

/*
FNXC:TaskLifecycleTools 2026-07-07-00:00:
Regression coverage for FN-7661: fn_task_archive / fn_task_delete previously never exposed
removeLineageReferences, so a task still referenced as a lineage parent by another task was
permanently stuck even though the store's TaskHasLineageChildrenError message told callers to
pass that flag. These tests reproduce the original stuck-task symptom and assert it is gone via
the actual agent-facing tools, mirroring the mock-API harness in task-delete-allow-resurrection.test.ts
and the lineage fixture setup in soft-delete-lineage-children.test.ts.
*/

type RegisteredTool = {
  name: string;
  execute: (toolCallId: string, params: any, signal: AbortSignal | undefined, onUpdate: any, ctx: { cwd: string; taskId?: string; agentId?: string; runId?: string }) => Promise<any>;
};

function createMockAPI() {
  const tools = new Map<string, RegisteredTool>();
  return {
    tools,
    registerTool(tool: RegisteredTool) {
      tools.set(tool.name, tool);
    },
    registerCommand() {
      // no-op for tests
    },
    on() {
      // no-op for tests
    },
  } as any;
}

describe("fn_task_archive / fn_task_delete removeLineageReferences plumbing", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "fn-task-lineage-unlink-"));
    await mkdir(join(rootDir, ".fusion"), { recursive: true });
  });

  afterEach(async () => {
    await closeCachedStores();
    await rm(rootDir, { recursive: true, force: true });
  });

  async function createParentAndChild(store: TaskStore, parentColumn: "todo" | "done" = "todo") {
    const parent = await store.createTask({ column: parentColumn, title: "parent", description: "parent" });
    const child = await store.createTask({ column: "todo", title: "child", description: "child" });
    (store as any).db
      .prepare("UPDATE tasks SET sourceParentTaskId = ?, sourceType = ?, updatedAt = ? WHERE id = ?")
      .run(parent.id, "task_refine", new Date().toISOString(), child.id);
    return { parent, child: await store.getTask(child.id) };
  }

  it("fn_task_archive rejects a lineage parent when removeLineageReferences is omitted", async () => {
    const store = new TaskStore(rootDir);
    await store.init();
    const { parent } = await createParentAndChild(store);

    const api = createMockAPI();
    kbExtension(api);
    const tool = api.tools.get("fn_task_archive") as RegisteredTool;

    await expect(tool.execute("call-1", { id: parent.id }, undefined, undefined, { cwd: rootDir })).rejects.toThrow(
      /still referenced as a lineage parent/,
    );

    const row = (store as any).readTaskFromDb(parent.id, { includeDeleted: true }) as { column: string };
    expect(row.column).not.toBe("archived");
  });

  it("fn_task_archive rejects a lineage parent when removeLineageReferences is explicitly false", async () => {
    const store = new TaskStore(rootDir);
    await store.init();
    const { parent } = await createParentAndChild(store);

    const api = createMockAPI();
    kbExtension(api);
    const tool = api.tools.get("fn_task_archive") as RegisteredTool;

    await expect(
      tool.execute("call-2", { id: parent.id, removeLineageReferences: false }, undefined, undefined, { cwd: rootDir }),
    ).rejects.toThrow(/still referenced as a lineage parent/);
  });

  it("fn_task_archive with removeLineageReferences:true archives the parent and clears the child reference", async () => {
    const store = new TaskStore(rootDir);
    await store.init();
    const { parent, child } = await createParentAndChild(store);

    const api = createMockAPI();
    kbExtension(api);
    const tool = api.tools.get("fn_task_archive") as RegisteredTool;
    const result = await tool.execute(
      "call-3",
      { id: parent.id, removeLineageReferences: true },
      undefined,
      undefined,
      { cwd: rootDir },
    );

    expect(result.details.column).toBe("archived");
    const archived = await store.getTask(parent.id);
    expect(archived.column).toBe("archived");

    const updatedChild = await store.getTask(child.id);
    expect(updatedChild.sourceParentTaskId).toBeUndefined();
  });

  it("fn_task_archive with no lineage children behaves unchanged and preserves cleanup default", async () => {
    const store = new TaskStore(rootDir);
    await store.init();
    const task = await store.createTask({ column: "done", title: "solo", description: "no children" });

    const api = createMockAPI();
    kbExtension(api);
    const tool = api.tools.get("fn_task_archive") as RegisteredTool;
    const result = await tool.execute("call-4", { id: task.id }, undefined, undefined, { cwd: rootDir });

    expect(result.details.column).toBe("archived");
  });

  it("fn_task_delete rejects a lineage parent when removeLineageReferences is omitted", async () => {
    const store = new TaskStore(rootDir);
    await store.init();
    const { parent } = await createParentAndChild(store);

    const api = createMockAPI();
    kbExtension(api);
    const tool = api.tools.get("fn_task_delete") as RegisteredTool;

    await expect(tool.execute("call-5", { id: parent.id }, undefined, undefined, { cwd: rootDir })).rejects.toThrow(
      /still referenced as a lineage parent/,
    );

    const row = (store as any).readTaskFromDb(parent.id, { includeDeleted: true }) as { deletedAt?: string };
    expect(row.deletedAt).toBeUndefined();
  });

  it("fn_task_delete rejects a lineage parent when removeLineageReferences is explicitly false", async () => {
    const store = new TaskStore(rootDir);
    await store.init();
    const { parent } = await createParentAndChild(store);

    const api = createMockAPI();
    kbExtension(api);
    const tool = api.tools.get("fn_task_delete") as RegisteredTool;

    await expect(
      tool.execute("call-6", { id: parent.id, removeLineageReferences: false }, undefined, undefined, { cwd: rootDir }),
    ).rejects.toThrow(/still referenced as a lineage parent/);
  });

  it("fn_task_delete with removeLineageReferences:true soft-deletes the parent and clears the child reference", async () => {
    const store = new TaskStore(rootDir);
    await store.init();
    const { parent, child } = await createParentAndChild(store);

    const api = createMockAPI();
    kbExtension(api);
    const tool = api.tools.get("fn_task_delete") as RegisteredTool;
    const result = await tool.execute(
      "call-7",
      { id: parent.id, removeLineageReferences: true },
      undefined,
      undefined,
      { cwd: rootDir },
    );

    expect(result.content[0]?.text).toBe(`Deleted ${parent.id}`);
    const deleted = (store as any).readTaskFromDb(parent.id, { includeDeleted: true }) as { deletedAt?: string };
    expect(deleted.deletedAt).toBeTruthy();

    const updatedChild = await store.getTask(child.id);
    expect(updatedChild.sourceParentTaskId).toBeUndefined();
  });

  it("fn_task_delete with no lineage children behaves unchanged", async () => {
    const store = new TaskStore(rootDir);
    await store.init();
    const task = await store.createTask({ column: "todo", title: "solo", description: "no children" });

    const api = createMockAPI();
    kbExtension(api);
    const tool = api.tools.get("fn_task_delete") as RegisteredTool;
    const result = await tool.execute("call-8", { id: task.id }, undefined, undefined, { cwd: rootDir });

    expect(result.content[0]?.text).toBe(`Deleted ${task.id}`);
    const deleted = (store as any).readTaskFromDb(task.id, { includeDeleted: true }) as { deletedAt?: string };
    expect(deleted.deletedAt).toBeTruthy();
  });
});
