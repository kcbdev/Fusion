import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { appendFile, readFile, writeFile, mkdir, rm, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import * as projectMemory from "../project-memory.js";
import { AgentStore } from "../agent-store.js";
import { CentralDatabase } from "../central-db.js";
import { TaskStore, TaskHasDependentsError } from "../store.js";
import { buildResearchDocumentKey, type Task } from "../types.js";
import { createTaskStoreTestHarness, makeTmpDir } from "./store-test-helpers.js";

describe("TaskStore", () => {
  const harness = createTaskStoreTestHarness();
  let rootDir: string;
  let globalDir: string;
  let store: TaskStore;

  beforeEach(async () => {
    await harness.beforeEach();
    rootDir = harness.rootDir();
    globalDir = harness.globalDir();
    store = harness.store();
  });

  afterEach(async () => {
    await harness.afterEach();
  });

  const createTestTask = () => harness.createTestTask();
  const createTaskWithSteps = () => harness.createTaskWithSteps();
  const deleteTaskDir = (taskId: string) => harness.deleteTaskDir(taskId);
  const createSourceIssueFixture = () => harness.createSourceIssueFixture();
  const insertLogEntryWithTimestamp = (...args: any[]) => (harness as any).insertLogEntryWithTimestamp(...args);

  describe("SQLite-first reads when task blobs are missing", () => {
    it("getTask returns metadata from SQLite with an empty prompt when the task directory is missing", async () => {
      const task = await createTestTask();
      await deleteTaskDir(task.id);

      const fetched = await store.getTask(task.id);

      expect(fetched.id).toBe(task.id);
      expect(fetched.description).toBe(task.description);
      expect(fetched.prompt).toBe("");
    });

    it("getTask syncs steps from PROMPT.md when task.steps is empty", async () => {
      const task = await store.createTask({ description: "Test task" });
      // task.steps should be empty in DB
      const dir = join(rootDir, ".fusion", "tasks", task.id);
      await writeFile(
        join(dir, "PROMPT.md"),
        `# ${task.id}: Test task

## Steps

### Step 0: Preflight
- [ ] Check something

### Step 1: Do the thing
- [ ] Do it
`,
      );

      const detail = await store.getTask(task.id);
      expect(detail.steps).toEqual([
        { name: "Preflight", status: "pending" },
        { name: "Do the thing", status: "pending" },
      ]);
    });
  });


  describe("shared mesh snapshots", () => {
    it("persists and replicates extended lease metadata", async () => {
      const task = await store.createTask({ description: "lease snapshot task" });
      await store.updateTask(task.id, {
        checkedOutBy: "agent-1",
        checkedOutAt: "2026-05-01T00:00:00.000Z",
        checkoutNodeId: "node-a",
        checkoutRunId: "run-1",
        checkoutLeaseRenewedAt: "2026-05-01T00:01:00.000Z",
        checkoutLeaseEpoch: 7,
      });

      const snapshot = await store.getTaskMetadataSnapshot();
      const replicated = snapshot.payload.tasks.find((entry) => entry.id === task.id);

      expect(replicated).toMatchObject({
        checkedOutBy: "agent-1",
        checkedOutAt: "2026-05-01T00:00:00.000Z",
        checkoutNodeId: "node-a",
        checkoutRunId: "run-1",
        checkoutLeaseRenewedAt: "2026-05-01T00:01:00.000Z",
        checkoutLeaseEpoch: 7,
      });

      await store.updateTask(task.id, { checkedOutBy: null, checkoutLeaseEpoch: 8 });
      const released = await store.getTask(task.id);
      expect(released).toMatchObject({ checkedOutBy: undefined, checkoutLeaseEpoch: 8 });
    });

    it("exports and reapplies task/activity/audit snapshots deterministically", async () => {
      const task = await store.createTask({ description: "snapshot task" });
      await store.updateTask(task.id, { worktree: "/tmp/fn-worktree", executionStartBranch: "fn/base" });
      await store.recordActivity({ type: "task:created", taskId: task.id, details: "created" });

      const taskSnapshot = await store.getTaskMetadataSnapshot();
      const activitySnapshot = await store.getActivityLogSnapshot();
      const auditSnapshot = store.getRunAuditSnapshot();

      const taskResult = await store.applyTaskMetadataSnapshot(taskSnapshot);
      const activityResult = store.applyActivityLogSnapshot(activitySnapshot);
      const auditResult = store.applyRunAuditSnapshot(auditSnapshot);

      const taskSnapshot2 = await store.getTaskMetadataSnapshot();
      const activitySnapshot2 = await store.getActivityLogSnapshot();
      const auditSnapshot2 = store.getRunAuditSnapshot();

      expect(taskResult.applied + taskResult.skipped).toBeGreaterThan(0);
      expect(taskSnapshot2.payload).toEqual(taskSnapshot.payload);
      expect(activitySnapshot2.payload).toEqual(activitySnapshot.payload);
      expect(auditSnapshot2.payload).toEqual(auditSnapshot.payload);
      expect(activityResult.skipped).toBeGreaterThanOrEqual(1);
      expect(auditResult.skipped).toBeGreaterThanOrEqual(0);

      const persisted = await store.getTask(task.id);
      expect(persisted?.worktree).toBe("/tmp/fn-worktree");
      expect(persisted?.executionStartBranch).toBe("fn/base");
    });
  });
});
