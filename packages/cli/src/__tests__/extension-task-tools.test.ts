import { describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("@fusion/dashboard", () => ({
  registerGithubTrackingHook: vi.fn(),
}));

vi.mock("@fusion/engine", () => ({
  createFnAgent: vi.fn(),
  fetchWebContent: vi.fn(),
}));

import kbExtension from "../extension.js";
import { TaskStore } from "@fusion/core";

function makeCtx(cwd: string) {
  return { cwd } as any;
}

describe("extension task tools resolve repo root from worktrees", () => {
  it("uses canonical project root for fn_task_show and fn_task_list from worktree cwd", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "fn-4904-cli-"));
    const worktreeRoot = join(repoRoot, ".worktrees", "feature");
    try {
      await mkdir(join(repoRoot, ".fusion"), { recursive: true });
      await mkdir(join(worktreeRoot, ".fusion"), { recursive: true });

      const store = new TaskStore(repoRoot);
      await store.init();
      await store.createTask({ description: "Task from canonical root" });

      const tools = new Map<string, any>();
      kbExtension({
        registerTool(def: any) {
          tools.set(def.name, def);
        },
        registerCommand: vi.fn(),
        registerShortcut: vi.fn(),
        registerFlag: vi.fn(),
        on: vi.fn(),
      } as any);

      const showTool = tools.get("fn_task_show");
      const listTool = tools.get("fn_task_list");
      expect(showTool).toBeTruthy();
      expect(listTool).toBeTruthy();

      const show = await showTool.execute("show", { id: "FN-001" }, undefined, undefined, makeCtx(worktreeRoot));
      const list = await listTool.execute("list", {}, undefined, undefined, makeCtx(worktreeRoot));

      expect(show.content[0].text).toContain("FN-001");
      expect(show.content[0].text).toContain("Task from canonical root");
      expect(list.content[0].text).toContain("FN-001");
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });
});
