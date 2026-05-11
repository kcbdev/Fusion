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

  describe("write lock serialization", () => {
    it("serializes concurrent logEntry and updateStep calls without corruption", async () => {
      const task = await createTaskWithSteps();
      const id = task.id;

      // Fire 20 concurrent operations: 10 logEntry + 10 updateStep (alternating steps)
      const promises: Promise<Task>[] = [];
      for (let i = 0; i < 20; i++) {
        if (i % 2 === 0) {
          promises.push(store.logEntry(id, `Log entry ${i}`));
        } else {
          // Toggle step 0 between in-progress and done
          const status = i % 4 === 1 ? "in-progress" : "done";
          promises.push(store.updateStep(id, 0, status));
        }
      }

      await Promise.all(promises);

      // Read back and verify valid JSON
      const taskJsonPath = join(rootDir, ".fusion", "tasks", id, "task.json");
      const raw = await readFile(taskJsonPath, "utf-8");
      const result = JSON.parse(raw) as Task;

      // Check all 10 log entries are present (plus initial "Task created" + step update logs)
      const customLogs = result.log.filter((l) => l.action.startsWith("Log entry"));
      expect(customLogs).toHaveLength(10);
    });
  });

  // ── Defensive parsing test ───────────────────────────────────────


  describe("defensive JSON parsing", () => {
    it("reads from SQLite even if task.json on disk is corrupted", async () => {
      const task = await createTestTask();
      const taskJsonPath = join(rootDir, ".fusion", "tasks", task.id, "task.json");

      // Corrupt the file: append duplicate trailing content
      const validJson = await readFile(taskJsonPath, "utf-8");
      const corrupted = validJson + validJson.slice(validJson.length / 2);
      await writeFile(taskJsonPath, corrupted);

      // SQLite still has valid data — getTask should succeed
      const detail = await store.getTask(task.id);
      expect(detail.id).toBe(task.id);
    });

    it("reads from SQLite even if task.json contains invalid content", async () => {
      const task = await createTestTask();
      const taskJsonPath = join(rootDir, ".fusion", "tasks", task.id, "task.json");

      // Write completely invalid content
      await writeFile(taskJsonPath, "not json at all {{{");

      // SQLite still has valid data — getTask should succeed
      const detail = await store.getTask(task.id);
      expect(detail.id).toBe(task.id);
    });
  });

  // ── Atomic write test ────────────────────────────────────────────


  describe("atomic writes", () => {
    it("produces valid JSON after write with no .tmp files left behind", async () => {
      const task = await createTestTask();
      const dir = join(rootDir, ".fusion", "tasks", task.id);

      // Perform a write
      await store.logEntry(task.id, "atomic test");

      // Verify valid JSON
      const raw = await readFile(join(dir, "task.json"), "utf-8");
      const parsed = JSON.parse(raw) as Task;
      expect(parsed.log.some((l) => l.action === "atomic test")).toBe(true);

      // Verify no .tmp files
      const files = await readdir(dir);
      expect(files.filter((f) => f.endsWith(".tmp"))).toHaveLength(0);
    });
  });

  // ── Atomic config writes ──────────────────────────────────────────


  describe("atomic config writes", () => {
    it("produces valid config.json with unique sequential IDs after 5 parallel createTask calls", async () => {
      const promises = Array.from({ length: 5 }, (_, i) =>
        store.createTask({ description: `Concurrent task ${i}` }),
      );
      const tasks = await Promise.all(promises);

      // All IDs should be unique
      const ids = tasks.map((t) => t.id);
      expect(new Set(ids).size).toBe(5);

      // IDs should be sequential (FN-001 through FN-005)
      const sortedIds = [...ids].sort();
      expect(sortedIds).toEqual(["FN-001", "FN-002", "FN-003", "FN-004", "FN-005"]);

      // config.json should be valid JSON with nextId = 6
      const configPath = join(rootDir, ".fusion", "config.json");
      const raw = await readFile(configPath, "utf-8");
      const config = JSON.parse(raw);
      expect(config.nextId).toBe(6);

      // No .tmp files left behind
      const haiDir = join(rootDir, ".fusion");
      const files = await readdir(haiDir);
      expect(files.filter((f) => f.endsWith(".tmp"))).toHaveLength(0);
    });
  });

  // ── Attachment tests ──────────────────────────────────────────────



  describe("concurrent stress", () => {
    it("handles 10 parallel logEntry calls preserving all entries", async () => {
      const task = await createTestTask();
      const initialLogCount = task.log.length; // 1 ("Task created")

      const promises = Array.from({ length: 10 }, (_, i) =>
        store.logEntry(task.id, `Stress log ${i}`),
      );
      await Promise.all(promises);

      const result = await store.getTask(task.id);
      const stressLogs = result.log.filter((l) => l.action.startsWith("Stress log"));
      expect(stressLogs).toHaveLength(10);
      expect(result.log).toHaveLength(initialLogCount + 10);
    });
  });


  describe("directory recreation for file-backed blobs", () => {
    it("pauseTask recreates missing task directory before writing task.json", async () => {
      const task = await createTestTask();
      const dir = await deleteTaskDir(task.id);

      const paused = await store.pauseTask(task.id, true);

      expect(paused.paused).toBe(true);
      expect(existsSync(dir)).toBe(true);
      expect(existsSync(join(dir, "task.json"))).toBe(true);

      const fetched = await store.getTask(task.id);
      expect(fetched.paused).toBe(true);
    });

    it("updateStep recreates missing task directory and persists regenerated task.json", async () => {
      const task = await createTaskWithSteps();
      const promptDir = join(rootDir, ".fusion", "tasks", task.id);
      const prompt = await readFile(join(promptDir, "PROMPT.md"), "utf-8");
      const dir = await deleteTaskDir(task.id);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "PROMPT.md"), prompt);

      const updated = await store.updateStep(task.id, 0, "in-progress");

      expect(updated.steps[0].status).toBe("in-progress");
      expect(existsSync(dir)).toBe(true);
      expect(existsSync(join(dir, "task.json"))).toBe(true);

      const fetched = await store.getTask(task.id);
      expect(fetched.steps[0].status).toBe("in-progress");
    });

    it("preserves done/skipped steps when updateStep is called with in-progress", async () => {
      const task = await createTaskWithSteps();
      await store.updateStep(task.id, 0, "done");
      await store.updateStep(task.id, 1, "done");
      const beforeRegression = await store.getTask(task.id);
      const currentStepBefore = beforeRegression.currentStep;

      // Agent erroneously re-marks an already-done step as in-progress.
      const result = await store.updateStep(task.id, 0, "in-progress");

      expect(result.steps[0].status).toBe("done");
      expect(result.steps[1].status).toBe("done");
      expect(result.currentStep).toBe(currentStepBefore);

      const fetched = await store.getTask(task.id);
      expect(fetched.steps[0].status).toBe("done");
      expect(fetched.currentStep).toBe(currentStepBefore);
    });

    it("addComment recreates missing task directory before persisting metadata", async () => {
      const task = await createTestTask();
      const dir = await deleteTaskDir(task.id);

      const updated = await store.addComment(task.id, "Please recover from missing directory");

      expect(updated.comments).toHaveLength(1);
      expect(existsSync(dir)).toBe(true);
      expect(existsSync(join(dir, "task.json"))).toBe(true);

      const fetched = await store.getTask(task.id);
      expect(fetched.comments).toHaveLength(1);
    });

    it("addAttachment recreates missing task directory and attachment directory", async () => {
      const task = await createTestTask();
      const dir = await deleteTaskDir(task.id);

      const attachment = await store.addAttachment(task.id, "note.txt", Buffer.from("hello"), "text/plain");

      expect(existsSync(dir)).toBe(true);
      expect(existsSync(join(dir, "attachments", attachment.filename))).toBe(true);
      expect(existsSync(join(dir, "task.json"))).toBe(true);

      const fetched = await store.getTask(task.id);
      expect(fetched.attachments).toHaveLength(1);
    });

    it("updateTask recreates missing task directory before rewriting PROMPT.md", async () => {
      const task = await createTestTask();
      const dir = await deleteTaskDir(task.id);
      const prompt = "# KB-001\n\nRecovered prompt\n";

      const updated = await store.updateTask(task.id, { title: "Recovered", prompt });

      expect(updated.title).toBe("Recovered");
      expect(existsSync(dir)).toBe(true);
      expect(existsSync(join(dir, "PROMPT.md"))).toBe(true);
      expect(await readFile(join(dir, "PROMPT.md"), "utf-8")).toBe(prompt);

      const fetched = await store.getTask(task.id);
      expect(fetched.title).toBe("Recovered");
      expect(fetched.prompt).toBe(prompt);
    });

    it("duplicateTask recreates the new task directory before copying PROMPT.md", async () => {
      const task = await createTestTask();

      const duplicate = await store.duplicateTask(task.id);
      const duplicateDir = join(rootDir, ".fusion", "tasks", duplicate.id);

      expect(existsSync(duplicateDir)).toBe(true);
      expect(existsSync(join(duplicateDir, "PROMPT.md"))).toBe(true);
      expect(await readFile(join(duplicateDir, "PROMPT.md"), "utf-8")).toContain(task.description);
    });
  });


  describe("pauseTask", () => {
    it("sets paused flag to true and adds log entry", async () => {
      const task = await createTestTask();
      const paused = await store.pauseTask(task.id, true);

      expect(paused.paused).toBe(true);
      expect(paused.log.some((l) => l.action === "Task paused")).toBe(true);

      // Verify persistence
      const fetched = await store.getTask(task.id);
      expect(fetched.paused).toBe(true);
    });

    it("unpauses a paused task and clears paused flag", async () => {
      const task = await createTestTask();
      await store.pauseTask(task.id, true);
      const unpaused = await store.pauseTask(task.id, false);

      expect(unpaused.paused).toBeUndefined();
      expect(unpaused.log.some((l) => l.action === "Task unpaused")).toBe(true);

      const fetched = await store.getTask(task.id);
      expect(fetched.paused).toBeUndefined();
    });

    it("emits task:updated event", async () => {
      const task = await createTestTask();
      const events: any[] = [];
      store.on("task:updated", (t) => events.push(t));

      await store.pauseTask(task.id, true);

      expect(events).toHaveLength(1);
      expect(events[0].paused).toBe(true);
    });

    it("sets status to 'paused' when pausing an in-progress task", async () => {
      const task = await createTestTask();
      // Move to in-progress: triage → todo → in-progress
      await store.moveTask(task.id, "todo");
      await store.moveTask(task.id, "in-progress");

      const paused = await store.pauseTask(task.id, true);
      expect(paused.paused).toBe(true);
      expect(paused.status).toBe("paused");
    });

    it("clears status when unpausing an in-progress task", async () => {
      const task = await createTestTask();
      await store.moveTask(task.id, "todo");
      await store.moveTask(task.id, "in-progress");

      await store.pauseTask(task.id, true);
      const unpaused = await store.pauseTask(task.id, false);
      expect(unpaused.paused).toBeUndefined();
      expect(unpaused.status).toBeUndefined();
    });

    it("sets and clears paused status for in-review tasks", async () => {
      const task = await createTestTask();
      await store.moveTask(task.id, "todo");
      await store.moveTask(task.id, "in-progress");
      await store.moveTask(task.id, "in-review");

      const paused = await store.pauseTask(task.id, true);
      expect(paused.paused).toBe(true);
      expect(paused.status).toBe("paused");

      const unpaused = await store.pauseTask(task.id, false);
      expect(unpaused.paused).toBeUndefined();
      expect(unpaused.status).toBeUndefined();
    });

    it("round-trips pause/unpause correctly", async () => {
      const task = await createTestTask();

      await store.pauseTask(task.id, true);
      let fetched = await store.getTask(task.id);
      expect(fetched.paused).toBe(true);

      await store.pauseTask(task.id, false);
      fetched = await store.getTask(task.id);
      expect(fetched.paused).toBeUndefined();

      await store.pauseTask(task.id, true);
      fetched = await store.getTask(task.id);
      expect(fetched.paused).toBe(true);
    });

    it("sets pausedByAgentId and logs agent pause reason", async () => {
      const task = await createTestTask();
      const paused = await store.pauseTask(task.id, true, undefined, { pausedByAgentId: "agent-1" });

      expect(paused.pausedByAgentId).toBe("agent-1");
      expect(paused.log.at(-1)?.action).toBe("Task paused (agent agent-1 paused)");
    });

    it("clears pausedByAgentId and logs agent resume reason", async () => {
      const task = await createTestTask();
      await store.pauseTask(task.id, true, undefined, { pausedByAgentId: "agent-2" });

      const unpaused = await store.pauseTask(task.id, false);
      expect(unpaused.pausedByAgentId).toBeUndefined();
      expect(unpaused.log.at(-1)?.action).toBe("Task unpaused (agent agent-2 resumed)");
    });

    it("uses standard unpause log when task was not paused by an agent", async () => {
      const task = await createTestTask();
      await store.pauseTask(task.id, true);

      const unpaused = await store.pauseTask(task.id, false);
      expect(unpaused.pausedByAgentId).toBeUndefined();
      expect(unpaused.log.at(-1)?.action).toBe("Task unpaused");
    });

    it("keeps pausedByAgentId undefined when pausing without agent options", async () => {
      const task = await createTestTask();
      const paused = await store.pauseTask(task.id, true);

      expect(paused.pausedByAgentId).toBeUndefined();
    });
  });


  describe("clearStaleExecutionStartBranchReferences (FN-2165)", () => {
    it("nulls baseBranch on live tasks that reference a deleted branch", async () => {
      const upstream = await store.createTask({ description: "Upstream" });
      const dependent = await store.createTask({ description: "Dependent" });
      await store.updateTask(dependent.id, {
        executionStartBranch: `fusion/${upstream.id.toLowerCase()}-2`,
      });

      const cleared = store.clearStaleExecutionStartBranchReferences([
        `fusion/${upstream.id.toLowerCase()}-2`,
      ]);

      expect(cleared).toEqual([dependent.id]);
      const reloaded = await store.getTask(dependent.id);
      expect(reloaded.executionStartBranch).toBeUndefined();
    });

    it("excludes the owner task so archival doesn't null its own baseBranch", async () => {
      const upstream = await store.createTask({ description: "Upstream" });
      await store.updateTask(upstream.id, { executionStartBranch: "fusion/some-base" });

      const cleared = store.clearStaleExecutionStartBranchReferences(
        ["fusion/some-base"],
        upstream.id,
      );

      expect(cleared).toEqual([]);
      const reloaded = await store.getTask(upstream.id);
      expect(reloaded.executionStartBranch).toBe("fusion/some-base");
    });

    it("returns [] and is a no-op when no branches given", () => {
      expect(store.clearStaleExecutionStartBranchReferences([])).toEqual([]);
    });

    it("clears baseBranch on multiple dependents in one call", async () => {
      const [a, b, c] = await Promise.all([
        store.createTask({ description: "A" }),
        store.createTask({ description: "B" }),
        store.createTask({ description: "C" }),
      ]);
      await store.updateTask(a.id, { executionStartBranch: "fusion/gone-a" });
      await store.updateTask(b.id, { executionStartBranch: "fusion/gone-b" });
      await store.updateTask(c.id, { executionStartBranch: "fusion/still-alive" });

      const cleared = store.clearStaleExecutionStartBranchReferences([
        "fusion/gone-a",
        "fusion/gone-b",
      ]);

      expect(cleared.sort()).toEqual([a.id, b.id].sort());
      const cReloaded = await store.getTask(c.id);
      expect(cReloaded.executionStartBranch).toBe("fusion/still-alive");
    });
  });


});
