import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import type { Task, TaskCommitAssociation } from "@fusion/core";
import { EventEmitter } from "node:events";
import { createServer } from "../server.js";

class RealGitStore extends EventEmitter {
  private tasks = new Map<string, Task>();
  private associations = new Map<string, TaskCommitAssociation[]>();

  constructor(private rootDir: string) {
    super();
  }

  getRootDir(): string {
    return this.rootDir;
  }

  getFusionDir(): string {
    return join(this.rootDir, ".fusion");
  }

  getDatabase() {
    return {
      exec: () => {},
      prepare: () => ({ run: () => ({ changes: 0 }), get: () => undefined, all: () => [] }),
    };
  }

  getMissionStore() {
    return {
      listMissions: async () => [],
      listTemplates: async () => [],
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

  setAssociations(lineageId: string, associations: TaskCommitAssociation[]): void {
    this.associations.set(lineageId, associations);
  }

  async getTaskCommitAssociationsByLineageId(lineageId: string): Promise<TaskCommitAssociation[]> {
    return this.associations.get(lineageId) ?? [];
  }
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function commitFile(cwd: string, file: string, content: string, message: string): string {
  writeFileSync(join(cwd, file), content);
  git(cwd, "add", file);
  git(cwd, "commit", "-m", message);
  return git(cwd, "rev-parse", "HEAD");
}

describe("FN-4521 done-task lineage aggregation", () => {
  it("keeps lineage-only files and excludes interleaved non-lineage commits", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "fn-4521-lineage-"));

    try {
      git(rootDir, "init", "-b", "main");
      git(rootDir, "config", "user.email", "fusion@example.com");
      git(rootDir, "config", "user.name", "Fusion");

      commitFile(rootDir, "base.txt", "base\n", "A base");

      git(rootDir, "checkout", "-b", "task-branch");
      const commitB = commitFile(rootDir, "a.ts", "export const a = 1;\n", "B task change a");

      git(rootDir, "checkout", "main");
      commitFile(rootDir, "unrelated.ts", "export const unrelated = true;\n", "C foreign change");

      git(rootDir, "checkout", "task-branch");
      git(rootDir, "merge", "main", "--no-edit");
      const commitD = commitFile(rootDir, "b.ts", "export const b = 2;\n", "D task change b");

      git(rootDir, "checkout", "main");
      git(rootDir, "merge", "task-branch", "--no-ff", "-m", "M merge task branch");
      const mergeCommit = git(rootDir, "rev-parse", "HEAD");

      const lineageId = "lin-fn-4521";
      const store = new RealGitStore(rootDir);
      store.addTask({
        id: "FN-4521",
        title: "lineage test",
        description: "lineage test",
        column: "done",
        dependencies: [],
        steps: [],
        currentStep: 0,
        log: [],
        createdAt: "2026-05-14T00:00:00.000Z",
        updatedAt: "2026-05-14T00:00:00.000Z",
        columnMovedAt: "2026-05-14T00:00:00.000Z",
        lineageId,
        baseBranch: "main",
        mergeDetails: { commitSha: mergeCommit, filesChanged: 2 },
      } as Task);

      const mkAssoc = (sha: string, authoredAt: string): TaskCommitAssociation => ({
        lineageId,
        commitSha: sha,
        commitSubject: sha,
        authoredAt,
        matchedBy: "manual",
        confidence: 1,
        taskIdSnapshot: "FN-4521",
        note: null,
        createdAt: authoredAt,
        updatedAt: authoredAt,
      });

      store.setAssociations(lineageId, [
        mkAssoc(commitB, "2026-05-14T00:00:01.000Z"),
        mkAssoc(commitD, "2026-05-14T00:00:02.000Z"),
      ]);

      const app = createServer(store as any);
      const { get } = await import("../test-request.js");
      const response = await get(app, "/api/tasks/FN-4521/diff");

      expect(response.status).toBe(200);
      const paths = response.body.files.map((f: { path: string }) => f.path).sort();
      expect(paths).toContain("a.ts");
      expect(paths).toContain("b.ts");
      // FN-4521 regression: pre-fix netRange (B^..merge) swept in unrelated.ts from interleaved commit C.
      expect(paths).not.toContain("unrelated.ts");
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
