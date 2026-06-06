/**
 * Agent-native company-model management tools (issue #4):
 *  - fn_board_create        (CEO-only) — create + seed a standard board
 *  - fn_task_move_board     (CEO-only) — cross-board re-home → target Todo
 *  - fn_plan_approve        (CEO-only) — release an awaiting-approval task
 *  - fn_plan_reject         (CEO-only) — log + clear status + force re-spec
 *  - fn_task_answer_input              — steering answer + unpause
 *  - fn_task_send_message              — queue addressed agent message
 *  - fn_board_convert_simple (CEO-only) — preview (default) / apply conform
 *
 * Each tool: happy path + permission rejection where gated. Run against a REAL
 * TaskStore + BoardStore (mirrors agent-tools-board-routing.test.ts).
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as core from "@fusion/core";
import {
  createBoardCreateTool,
  createTaskMoveBoardTool,
  createPlanApproveTool,
  createPlanRejectTool,
  createTaskAnswerInputTool,
  createTaskSendMessageTool,
  createBoardConvertSimpleTool,
  type CeoToolGate,
} from "../agent-tools.js";
import { deleteBoardAndRehome } from "../board-actions.js";

const dirs: string[] = [];

async function makeStore(): Promise<core.TaskStore> {
  const rootDir = await mkdtemp(join(tmpdir(), "board-actions-root-"));
  const globalDir = await mkdtemp(join(tmpdir(), "board-actions-global-"));
  dirs.push(rootDir, globalDir);
  const store = new core.TaskStore(rootDir, globalDir);
  await store.init();
  return store;
}

async function makeCompanyBoard(store: core.TaskStore, name: string, description = "") {
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

const CEO: CeoToolGate = { isCeo: true };
const NON_CEO: CeoToolGate = { isCeo: false };

// Helper: invoke a tool's execute the way the runtime does.
function run(tool: ReturnType<typeof createPlanApproveTool>, params: Record<string, unknown>) {
  return tool.execute("c", params as never, undefined as never, undefined as never, {} as never);
}

describe("fn_board_create (CEO-only)", () => {
  it("CEO creates a standard board", async () => {
    const store = await makeStore();
    try {
      const tool = createBoardCreateTool(store, CEO);
      const result = await run(tool, { name: "Marketing", description: "campaigns" });
      expect((result as { isError?: boolean }).isError).toBeFalsy();
      const boardId = (result.details as { boardId?: string }).boardId!;
      expect(boardId).toBeTruthy();
      const board = store.getBoardStore().getBoard(boardId)!;
      expect(board.name).toBe("Marketing");
      expect(board.description).toBe("campaigns");
    } finally {
      store.close();
    }
  });

  it("non-CEO is rejected (not-ceo) and onDenied fires", async () => {
    const store = await makeStore();
    try {
      const denials: Array<{ tool: string }> = [];
      const tool = createBoardCreateTool(store, { isCeo: false, onDenied: (i) => { denials.push(i); } });
      const result = await run(tool, { name: "X" });
      expect((result as { isError?: boolean }).isError).toBe(true);
      expect((result.details as { code?: string }).code).toBe("not-ceo");
      expect(denials[0]?.tool).toBe("fn_board_create");
    } finally {
      store.close();
    }
  });

  it("rejects a non-standard board_type", async () => {
    const store = await makeStore();
    try {
      const tool = createBoardCreateTool(store, CEO);
      const result = await run(tool, { name: "X", board_type: "compound-engineering" });
      expect((result as { isError?: boolean }).isError).toBe(true);
      expect((result.details as { code?: string }).code).toBe("unsupported-board-type");
    } finally {
      store.close();
    }
  });
});

describe("fn_task_move_board (CEO-only)", () => {
  it("CEO re-homes a task onto the target board's Todo", async () => {
    const store = await makeStore();
    try {
      const eng = await makeCompanyBoard(store, "Engineering");
      const content = await makeCompanyBoard(store, "Content");
      const created = await store.createTask({ description: "task to move", column: "todo", boardId: eng.id });

      const tool = createTaskMoveBoardTool(store, CEO);
      const result = await run(tool, { task_id: created.id, board_id: content.id });
      expect((result as { isError?: boolean }).isError).toBeFalsy();
      expect((result.details as { noop?: boolean }).noop).toBe(false);

      const moved = await store.getTask(created.id);
      expect(moved.boardId).toBe(content.id);
      expect(moved.column).toBe("todo");
    } finally {
      store.close();
    }
  });

  it("already-homed → no-op", async () => {
    const store = await makeStore();
    try {
      const eng = await makeCompanyBoard(store, "Engineering");
      const created = await store.createTask({ description: "stay put", column: "todo", boardId: eng.id });
      const tool = createTaskMoveBoardTool(store, CEO);
      const result = await run(tool, { task_id: created.id, board_id: eng.id });
      expect((result.details as { noop?: boolean }).noop).toBe(true);
    } finally {
      store.close();
    }
  });

  it("unknown board → board-not-found error", async () => {
    const store = await makeStore();
    try {
      const eng = await makeCompanyBoard(store, "Engineering");
      const created = await store.createTask({ description: "lost", column: "todo", boardId: eng.id });
      const tool = createTaskMoveBoardTool(store, CEO);
      const result = await run(tool, { task_id: created.id, board_id: "nope" });
      expect((result as { isError?: boolean }).isError).toBe(true);
      expect((result.details as { code?: string }).code).toBe("board-not-found");
    } finally {
      store.close();
    }
  });

  it("non-CEO is rejected", async () => {
    const store = await makeStore();
    try {
      const eng = await makeCompanyBoard(store, "Engineering");
      const content = await makeCompanyBoard(store, "Content");
      const created = await store.createTask({ description: "x", column: "todo", boardId: eng.id });
      const tool = createTaskMoveBoardTool(store, NON_CEO);
      const result = await run(tool, { task_id: created.id, board_id: content.id });
      expect((result as { isError?: boolean }).isError).toBe(true);
      expect((result.details as { code?: string }).code).toBe("not-ceo");
    } finally {
      store.close();
    }
  });
});

describe("deleteBoardAndRehome (re-home failure safety, issue #3)", () => {
  it("re-homes all tasks and deletes the board on full success", async () => {
    const store = await makeStore();
    try {
      const eng = await makeCompanyBoard(store, "Engineering");
      const t1 = await store.createTask({ description: "a", column: "todo", boardId: eng.id });
      const t2 = await store.createTask({ description: "b", column: "todo", boardId: eng.id });

      const result = await deleteBoardAndRehome(store, undefined, eng.id);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.deletedBoardId).toBe(eng.id);
        expect(result.rehomedTaskIds.sort()).toEqual([t1.id, t2.id].sort());
      }
      expect(store.getBoardStore().getBoard(eng.id)).toBeUndefined();
      // Both tasks re-homed off the (now-deleted) board onto the re-home target.
      const target = result.ok ? result.rehomedToBoardId : null;
      expect(target).not.toBeNull();
      expect((await store.getTask(t1.id)).boardId).toBe(target);
      expect((await store.getTask(t2.id)).boardId).toBe(target);
      expect((await store.getTask(t1.id)).boardId).not.toBe(eng.id);
    } finally {
      store.close();
    }
  });

  it("aborts (no deletion) with a typed failure when a task fails to re-home", async () => {
    const store = await makeStore();
    try {
      const eng = await makeCompanyBoard(store, "Engineering");
      await makeCompanyBoard(store, "Content"); // fallback re-home target
      const ok = await store.createTask({ description: "ok", column: "todo", boardId: eng.id });
      const bad = await store.createTask({ description: "bad", column: "todo", boardId: eng.id });

      // Simulate a concurrent delete of ONE task mid-sweep: moveTaskToBoard's
      // initial getTask(bad) throws (the task vanished), BEFORE any boardId
      // mutation — so `bad` still homes on the board being deleted. The deletion
      // must abort rather than orphan that reference.
      const origGetTask = store.getTask.bind(store);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (store as any).getTask = async (id: string, opts: any) => {
        if (id === bad.id) throw new Error("Task bad not found");
        return origGetTask(id, opts);
      };

      const result = await deleteBoardAndRehome(store, undefined, eng.id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (store as any).getTask = origGetTask;

      // Typed failure, board NOT deleted (still resolvable), no orphan.
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("rehome-failed");
      expect(store.getBoardStore().getBoard(eng.id)).toBeDefined();
      // The failed task STILL homes on the (intact) board.
      expect((await store.getTask(bad.id)).boardId).toBe(eng.id);
    } finally {
      store.close();
    }
  });
});

describe("fn_plan_approve / fn_plan_reject (CEO-only)", () => {
  it("approve releases an awaiting-approval task", async () => {
    const store = await makeStore();
    try {
      const created = await store.createTask({ description: "needs approval" });
      await store.updateTask(created.id, { status: "awaiting-approval" });
      const tool = createPlanApproveTool(store, CEO);
      const result = await run(tool, { task_id: created.id });
      expect((result as { isError?: boolean }).isError).toBeFalsy();
      const after = await store.getTask(created.id);
      expect(after.status).not.toBe("awaiting-approval");
    } finally {
      store.close();
    }
  });

  it("approve rejects a task not awaiting approval", async () => {
    const store = await makeStore();
    try {
      const created = await store.createTask({ description: "not pending approval" });
      const tool = createPlanApproveTool(store, CEO);
      const result = await run(tool, { task_id: created.id });
      expect((result as { isError?: boolean }).isError).toBe(true);
      expect((result.details as { code?: string }).code).toBe("not-awaiting-approval");
    } finally {
      store.close();
    }
  });

  it("approve: non-CEO is rejected", async () => {
    const store = await makeStore();
    try {
      const created = await store.createTask({ description: "x" });
      await store.updateTask(created.id, { status: "awaiting-approval" });
      const tool = createPlanApproveTool(store, NON_CEO);
      const result = await run(tool, { task_id: created.id });
      expect((result.details as { code?: string }).code).toBe("not-ceo");
      // unchanged
      expect((await store.getTask(created.id)).status).toBe("awaiting-approval");
    } finally {
      store.close();
    }
  });

  it("reject clears status and logs feedback", async () => {
    const store = await makeStore();
    try {
      const created = await store.createTask({ description: "reject me" });
      await store.updateTask(created.id, { status: "awaiting-approval" });
      const tool = createPlanRejectTool(store, CEO);
      const result = await run(tool, { task_id: created.id, feedback: "needs more detail" });
      expect((result as { isError?: boolean }).isError).toBeFalsy();
      // Byte-identical to the reject-plan route: the rejection + feedback are
      // logged. (The route's `updateTask({ status: undefined })` is a no-op on
      // status — undefined preserves; the re-spec is forced by PROMPT.md removal.)
      const reloaded = await store.getTask(created.id);
      const entries = (reloaded.log ?? []).map((e) => e.action);
      expect(entries.some((m) => m.includes("Plan rejected by user"))).toBe(true);
      expect(entries.some((m) => m.includes("needs more detail"))).toBe(true);
    } finally {
      store.close();
    }
  });

  it("reject: non-CEO is rejected", async () => {
    const store = await makeStore();
    try {
      const created = await store.createTask({ description: "x" });
      await store.updateTask(created.id, { status: "awaiting-approval" });
      const tool = createPlanRejectTool(store, NON_CEO);
      const result = await run(tool, { task_id: created.id });
      expect((result.details as { code?: string }).code).toBe("not-ceo");
    } finally {
      store.close();
    }
  });
});

describe("fn_task_answer_input", () => {
  it("records a steering comment and unpauses the task", async () => {
    const store = await makeStore();
    try {
      const created = await store.createTask({ description: "awaiting input" });
      await store.updateTask(created.id, { paused: true, pausedReason: "await-input:n1" });
      const tool = createTaskAnswerInputTool(store);
      const result = await run(tool, { task_id: created.id, text: "the answer" });
      expect((result as { isError?: boolean }).isError).toBeFalsy();
      const after = await store.getTask(created.id);
      expect(after.paused).toBeFalsy(); // unpaused (store omits the flag when false)
      expect(after.status).not.toBe("paused");
      const steering = after.steeringComments ?? [];
      expect(steering.some((c) => c.text === "the answer")).toBe(true);
    } finally {
      store.close();
    }
  });

  it("rejects empty text", async () => {
    const store = await makeStore();
    try {
      const created = await store.createTask({ description: "x" });
      const tool = createTaskAnswerInputTool(store);
      const result = await run(tool, { task_id: created.id, text: "   " });
      expect((result as { isError?: boolean }).isError).toBe(true);
    } finally {
      store.close();
    }
  });
});

describe("fn_task_send_message", () => {
  it("queues an addressed message", async () => {
    const store = await makeStore();
    try {
      const created = await store.createTask({ description: "msg target" });
      const tool = createTaskSendMessageTool(store, "agent");
      const result = await run(tool, { task_id: created.id, target_agent_id: "agent-42", text: "hello" });
      expect((result as { isError?: boolean }).isError).toBeFalsy();
      const messages = await store.listAgentMessages(created.id, { targetAgentId: "agent-42" });
      expect(messages.length).toBeGreaterThan(0);
      expect(messages.some((m) => m.text === "hello")).toBe(true);
    } finally {
      store.close();
    }
  });

  it("rejects over-long text", async () => {
    const store = await makeStore();
    try {
      const created = await store.createTask({ description: "x" });
      const tool = createTaskSendMessageTool(store, "agent");
      const result = await run(tool, { task_id: created.id, target_agent_id: "a", text: "x".repeat(2001) });
      expect((result as { isError?: boolean }).isError).toBe(true);
    } finally {
      store.close();
    }
  });
});

describe("fn_board_convert_simple (CEO-only)", () => {
  it("preview (default) returns mappings without changing the board", async () => {
    const store = await makeStore();
    try {
      const board = await makeCompanyBoard(store, "Legacy");
      const beforeWorkflowId = store.getBoardStore().getBoard(board.id)!.workflowId;
      const tool = createBoardConvertSimpleTool(store, CEO);
      const result = await run(tool, { board_id: board.id });
      expect((result as { isError?: boolean }).isError).toBeFalsy();
      expect((result.details as { preview?: boolean }).preview).toBe(true);
      expect(Array.isArray((result.details as { mappings?: unknown[] }).mappings)).toBe(true);
      // Unchanged.
      expect(store.getBoardStore().getBoard(board.id)!.workflowId).toBe(beforeWorkflowId);
    } finally {
      store.close();
    }
  });

  it("apply=true re-points the board at a conformed workflow", async () => {
    const store = await makeStore();
    try {
      const board = await makeCompanyBoard(store, "Legacy");
      const beforeWorkflowId = store.getBoardStore().getBoard(board.id)!.workflowId;
      const tool = createBoardConvertSimpleTool(store, CEO);
      const result = await run(tool, { board_id: board.id, apply: true });
      expect((result as { isError?: boolean }).isError).toBeFalsy();
      expect((result.details as { preview?: boolean }).preview).toBeUndefined();
      expect(store.getBoardStore().getBoard(board.id)!.workflowId).not.toBe(beforeWorkflowId);
    } finally {
      store.close();
    }
  });

  it("non-CEO is rejected", async () => {
    const store = await makeStore();
    try {
      const board = await makeCompanyBoard(store, "Legacy");
      const tool = createBoardConvertSimpleTool(store, NON_CEO);
      const result = await run(tool, { board_id: board.id });
      expect((result.details as { code?: string }).code).toBe("not-ceo");
    } finally {
      store.close();
    }
  });
});
