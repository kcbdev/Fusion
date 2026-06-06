/**
 * fn_task_create board routing + fn_board_list (company-model U8).
 *
 * Exercises the engine tool layer against a REAL TaskStore + BoardStore:
 *  - CEO routing creates a task in the target board's todo with the STORED
 *    board id stamped (AE5; multi-board; rename-resilient)
 *  - non-CEO callers supplying board_id get a typed error; without it → triage
 *  - unknown board id → typed error + onRoutingFailure audit hook fired
 *  - fn_board_list returns boards with names + descriptions
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as core from "@fusion/core";
import { createTaskCreateTool, createBoardListTool, type CeoTaskRoutingOptions } from "../agent-tools.js";

const dirs: string[] = [];

async function makeStore(): Promise<core.TaskStore> {
  const rootDir = await mkdtemp(join(tmpdir(), "ceo-route-root-"));
  const globalDir = await mkdtemp(join(tmpdir(), "ceo-route-global-"));
  dirs.push(rootDir, globalDir);
  const store = new core.TaskStore(rootDir, globalDir);
  await store.init();
  return store;
}

/** Create a board pointing at a custom workflow built from the company template
 *  (so the `lead` role resolves to the `todo` column). */
async function makeCompanyBoard(store: core.TaskStore, name: string, description: string) {
  const def = await store.createWorkflowDefinition({
    name: `${name} wf`,
    description,
    ir: core.COMPANY_BOARD_TEMPLATE_IR,
  });
  return store.getBoardStore().createBoard({ name, description, workflowId: def.id });
}

afterEach(async () => {
  while (dirs.length) {
    const d = dirs.pop();
    if (d) await rm(d, { recursive: true, force: true });
  }
});

const CEO: CeoTaskRoutingOptions = { isCeo: true };

describe("fn_task_create board routing (CEO, U8)", () => {
  it("AE5: single-board project — CEO routes to the board's todo with the stored id stamped", async () => {
    const store = await makeStore();
    try {
      const board = await makeCompanyBoard(store, "Engineering", "code work");
      const tool = createTaskCreateTool(store, undefined, undefined, CEO);

      const result = await tool.execute("c", { description: "build a feature", board_id: board.id } as any, undefined, undefined, {} as any);
      expect((result as { isError?: boolean }).isError).toBeFalsy();
      const taskId = (result.details as { taskId?: string }).taskId!;
      expect(taskId).toBeTruthy();
      expect((result.details as { boardId?: string }).boardId).toBe(board.id);

      const task = await store.getTask(taskId);
      expect(task.boardId).toBe(board.id);
      expect(task.column).toBe("todo");
    } finally {
      store.close();
    }
  });

  it("two boards: tool accepts either id and lands the task on the right board's todo", async () => {
    const store = await makeStore();
    try {
      const eng = await makeCompanyBoard(store, "Engineering", "code");
      const content = await makeCompanyBoard(store, "Content", "blog");
      const tool = createTaskCreateTool(store, undefined, undefined, CEO);

      const r1 = await tool.execute("c", { description: "write an article", board_id: content.id } as any, undefined, undefined, {} as any);
      const t1 = await store.getTask((r1.details as { taskId: string }).taskId);
      expect(t1.boardId).toBe(content.id);
      expect(t1.column).toBe("todo");

      const r2 = await tool.execute("c", { description: "ship a feature", board_id: eng.id } as any, undefined, undefined, {} as any);
      const t2 = await store.getTask((r2.details as { taskId: string }).taskId);
      expect(t2.boardId).toBe(eng.id);
    } finally {
      store.close();
    }
  });

  it("board rename: a task created before rename still resolves by stored id", async () => {
    const store = await makeStore();
    try {
      const board = await makeCompanyBoard(store, "Engineering", "code");
      const tool = createTaskCreateTool(store, undefined, undefined, CEO);
      const r = await tool.execute("c", { description: "task one", board_id: board.id } as any, undefined, undefined, {} as any);
      const taskId = (r.details as { taskId: string }).taskId;

      store.getBoardStore().updateBoard(board.id, { name: "Platform" });

      const task = await store.getTask(taskId);
      expect(task.boardId).toBe(board.id); // stored id, not the (now-stale) name
      expect(store.getBoardStore().getBoard(board.id)!.name).toBe("Platform");
    } finally {
      store.close();
    }
  });

  it("unknown board id → typed error + onRoutingFailure audit hook fired", async () => {
    const store = await makeStore();
    try {
      const failures: Array<{ code: string; boardId?: string }> = [];
      const ceo: CeoTaskRoutingOptions = {
        isCeo: true,
        onRoutingFailure: (info) => { failures.push(info); },
      };
      const tool = createTaskCreateTool(store, undefined, undefined, ceo);
      const result = await tool.execute("c", { description: "lost task", board_id: "no-such-board" } as any, undefined, undefined, {} as any);
      expect((result as { isError?: boolean }).isError).toBe(true);
      expect((result.details as { code?: string }).code).toBe("unknown-board");
      expect(failures).toHaveLength(1);
      expect(failures[0]).toMatchObject({ code: "unknown-board", boardId: "no-such-board" });
    } finally {
      store.close();
    }
  });

  // ── Ambiguous / no-match routing: the tool contract creates NOTHING ──────────
  //
  // CEO routing-by-description is policy in the CEO's SYSTEM INSTRUCTIONS, not a
  // tool that fuzzy-matches a board. So the tool's CONTRACT for the ambiguous /
  // zero-match case is: it never derives a board from a description — an
  // unresolvable board_id errors and creates no task, and an absent board_id is
  // the CEO's "ask a clarifying question first" path (no board stamped). These
  // assert that contract (not the LLM's routing choice).
  describe("ambiguous / no-match routing creates nothing", () => {
    it("unknown board id (no plausible match) → error AND no task is created", async () => {
      const store = await makeStore();
      try {
        const before = (await store.listTasks({ includeArchived: true })).length;
        const tool = createTaskCreateTool(store, undefined, undefined, CEO);
        const result = await tool.execute(
          "c",
          { description: "ambiguous request", board_id: "ambiguous-no-match" } as any,
          undefined, undefined, {} as any,
        );
        expect((result as { isError?: boolean }).isError).toBe(true);
        expect((result.details as { code?: string }).code).toBe("unknown-board");
        // The tool returns BEFORE createAgentTask — nothing is created.
        expect((result.details as { taskId?: string }).taskId).toBeUndefined();
        const after = await store.listTasks({ includeArchived: true });
        expect(after.length).toBe(before);
      } finally {
        store.close();
      }
    });

    it("non-CEO supplying a board_id → error AND no task is created (no lateral injection)", async () => {
      const store = await makeStore();
      try {
        const board = await makeCompanyBoard(store, "Engineering", "code");
        const before = (await store.listTasks({ includeArchived: true })).length;
        const tool = createTaskCreateTool(store, undefined, undefined, { isCeo: false });
        const result = await tool.execute(
          "c",
          { description: "inject", board_id: board.id } as any,
          undefined, undefined, {} as any,
        );
        expect((result as { isError?: boolean }).isError).toBe(true);
        expect((result.details as { code?: string }).code).toBe("not-ceo");
        const after = await store.listTasks({ includeArchived: true });
        expect(after.length).toBe(before);
      } finally {
        store.close();
      }
    });
  });
});

describe("fn_task_create board routing — authorization (non-CEO)", () => {
  it("a non-CEO agent supplying board_id gets a typed error", async () => {
    const store = await makeStore();
    try {
      const board = await makeCompanyBoard(store, "Engineering", "code");
      const failures: Array<{ code: string }> = [];
      // No ceoRouting → isCeo defaults to false. Provide a hook to assert it fires.
      const tool = createTaskCreateTool(store, undefined, undefined, {
        isCeo: false,
        onRoutingFailure: (info) => { failures.push(info); },
      });
      const result = await tool.execute("c", { description: "inject", board_id: board.id } as any, undefined, undefined, {} as any);
      expect((result as { isError?: boolean }).isError).toBe(true);
      expect((result.details as { code?: string }).code).toBe("not-ceo");
      expect(failures[0]).toMatchObject({ code: "not-ceo" });
    } finally {
      store.close();
    }
  });

  it("without board_id, a non-CEO caller creates in triage (today's behavior)", async () => {
    const store = await makeStore();
    try {
      const tool = createTaskCreateTool(store); // no ceoRouting at all
      const result = await tool.execute("c", { description: "ordinary out-of-scope task" } as any, undefined, undefined, {} as any);
      expect((result as { isError?: boolean }).isError).toBeFalsy();
      const task = await store.getTask((result.details as { taskId: string }).taskId);
      expect(task.column).toBe("triage");
      expect(task.boardId).toBeUndefined();
    } finally {
      store.close();
    }
  });

  it("with no board_id, a CEO-configured tool still creates in triage (byte-identical default path)", async () => {
    const store = await makeStore();
    try {
      const tool = createTaskCreateTool(store, undefined, undefined, CEO);
      const result = await tool.execute("c", { description: "no board specified" } as any, undefined, undefined, {} as any);
      const task = await store.getTask((result.details as { taskId: string }).taskId);
      expect(task.column).toBe("triage");
      expect(task.boardId).toBeUndefined();
    } finally {
      store.close();
    }
  });
});

describe("fn_board_list (U8)", () => {
  it("returns boards with names + descriptions for routing", async () => {
    const store = await makeStore();
    try {
      // A fresh store auto-creates a migration default "Board 1"; the routing
      // toolset lists every board, so assert ours are present (not exact equality).
      await makeCompanyBoard(store, "Engineering", "code work");
      await makeCompanyBoard(store, "Content", "blog and docs");
      const tool = createBoardListTool(store);
      const result = await tool.execute("c", {} as any, undefined, undefined, {} as any);
      const boards = (result.details as { boards: Array<{ name: string; description: string; columns: string[] }> }).boards;
      const names = boards.map((b) => b.name);
      expect(names).toContain("Engineering");
      expect(names).toContain("Content");
      const eng = boards.find((b) => b.name === "Engineering")!;
      expect(eng.description).toBe("code work");
      expect(eng.columns).toContain("Todo");
      const text = result.content[0]?.type === "text" ? result.content[0].text : "";
      expect(text).toContain("Engineering");
      expect(text).toContain("blog and docs");
    } finally {
      store.close();
    }
  });
});
