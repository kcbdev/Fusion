import { mkdtempSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";

vi.mock("node:child_process", async (importOriginal) => {
  const mod = await importOriginal<typeof import("node:child_process")>();
  return {
    ...mod,
    execSync: vi.fn((...args: Parameters<typeof mod.execSync>) => mod.execSync(...args)),
  };
});

vi.mock("../run-command.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../run-command.js")>();
  return {
    ...mod,
    runCommandAsync: vi.fn((...args: Parameters<typeof mod.runCommandAsync>) => mod.runCommandAsync(...args)),
  };
});

import { execSync } from "node:child_process";
import { runCommandAsync } from "../run-command.js";
import { TaskStore, TaskHasDependentsError } from "../store.js";
import type { Task } from "../types.js";

export { TaskStore, TaskHasDependentsError };

export const mockedExecSync = vi.mocked(execSync);
export const mockedRunCommandAsync = vi.mocked(runCommandAsync);

export function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "kb-store-test-"));
}

export function createTaskStoreTestHarness() {
  let rootDir = "";
  let globalDir = "";
  let store: TaskStore;

  return {
    rootDir: () => rootDir,
    globalDir: () => globalDir,
    store: () => store,
    beforeEach: async () => {
      rootDir = makeTmpDir();
      globalDir = makeTmpDir();
      store = new TaskStore(rootDir, globalDir, { inMemoryDb: true });
      await store.init();
    },
    afterEach: async () => {
      vi.useRealTimers();
      store.stopWatching();
      await new Promise<void>((resolve) => process.nextTick(resolve));
      store.close();
      await rm(rootDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      await rm(globalDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    },
    reopenDiskBackedStore: async () => {
      store.close();
      store = new TaskStore(rootDir, globalDir);
      await store.init();
    },
    createTestTask: async (): Promise<Task> => store.createTask({ description: "Test task" }),
    createTaskWithSteps: async (): Promise<Task> => {
      const task = await store.createTask({ description: "Task with steps" });
      const dir = join(rootDir, ".fusion", "tasks", task.id);
      await writeFile(
        join(dir, "PROMPT.md"),
        `# ${task.id}: Task with steps

## Steps

### Step 0: Preflight

- [ ] Check things

### Step 1: Implementation

- [ ] Do stuff

### Step 2: Testing

- [ ] Test stuff
`,
      );
      return task;
    },
    deleteTaskDir: async (taskId: string): Promise<string> => {
      const dir = join(rootDir, ".fusion", "tasks", taskId);
      await rm(dir, { recursive: true, force: true });
      return dir;
    },
    createSourceIssueFixture: () => ({
      provider: "github",
      repository: "runfusion/fusion",
      externalIssueId: "I_kgDOExample",
      issueNumber: 2471,
      url: "https://github.com/runfusion/fusion/issues/2471",
    }),
    insertLogEntryWithTimestamp: (...args: any[]): void => {
      let targetStore: TaskStore = store;
      let taskId: string;
      let text: string;
      let type: string;
      let timestamp: string;
      let detail: string | undefined;
      let agent: string | undefined;

      if (typeof args[0] === "object") {
        [targetStore, taskId, text, type, timestamp, detail, agent] = args;
      } else {
        [taskId, text, type, timestamp, detail, agent] = args;
      }

      (targetStore as any).db.prepare(`
      INSERT INTO agentLogEntries (taskId, timestamp, text, type, detail, agent)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(taskId, timestamp, text, type, detail ?? null, agent ?? null);
    },
  };
}
