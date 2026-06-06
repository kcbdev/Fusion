/**
 * Shared company-model board/plan action helpers (issue #4).
 *
 * The dashboard routes that drive the simple-mode UI (move-to-board, reject-plan,
 * create-board, convert-to-simple) inline their business logic. These helpers
 * extract that logic so the agent-native tools (fn_task_move_board,
 * fn_plan_reject, fn_board_create, fn_board_convert_simple) and the routes share
 * ONE implementation — the routes become thin wrappers calling these, keeping
 * route behavior byte-identical while the tools call the same engine logic
 * (tools never make HTTP calls).
 *
 * Engine depends on core (never the reverse); dashboard imports engine.
 */

import {
  AgentStore,
  buildCompanyConformPlan,
  isEphemeralAgent,
  resolveWorkflowIrById,
  seedBoardTeam,
  seedBoardTeamForBoard,
  type Board,
  type ConformColumnMapping,
  type Settings,
  type Task,
  type TaskStore,
} from "@fusion/core";

/**
 * Minimal AgentStore surface the move-to-board re-home needs to release a task's
 * execution-agent bindings. Mirrors the dashboard route's structural type so the
 * route can keep passing `engine.getAgentStore()`.
 */
export interface ExecutionAgentBindingReleaser {
  listAgents: (input: { includeEphemeral?: boolean }) => Promise<Array<{ id: string; taskId?: string }>>;
  syncExecutionTaskLink: (agentId: string, taskId: string | undefined) => Promise<unknown>;
  deleteAgent: (agentId: string) => Promise<unknown>;
}

/**
 * Release a task's execution-agent bindings (abort an in-flight session's
 * agent links). Ephemeral task-worker agents are deleted; durable agents have
 * their execution link cleared. A no-op when no agent store is available.
 *
 * Extracted from register-task-workflow-routes.ts so the move-to-board sequence
 * has one implementation shared by the route and the fn_task_move_board tool.
 */
export async function releaseExecutionAgentBindings(
  agentStore: ExecutionAgentBindingReleaser | undefined,
  taskId: string,
): Promise<void> {
  if (!agentStore) {
    return;
  }
  const linkedAgents = (await agentStore.listAgents({ includeEphemeral: true }))
    .filter((agent) => agent.taskId === taskId);

  for (const agent of linkedAgents) {
    if (isEphemeralAgent(agent as never)) {
      await agentStore.deleteAgent(agent.id);
      continue;
    }
    await agentStore.syncExecutionTaskLink(agent.id, undefined);
  }
}

export type MoveTaskToBoardResult =
  | { ok: true; noop: boolean; task: Task; fromBoardId: string | null; toBoardId: string; board: Board }
  | { ok: false; code: "task-not-found" | "board-not-found"; message: string };

/**
 * Cross-board move (U10, R13): re-home a task onto a different board and move it
 * to that board's Todo as a SYSTEM action — bypassing the human movement matrix
 * so the re-home is never blocked by the company-model drag rules. Any active
 * session's execution-agent bindings are released (the task restarts under the
 * target board's Lead). The re-home + abort are recorded in the task log.
 *
 * Byte-identical to the move-to-board route's inline sequence; the route now
 * calls this. Returns a structured result so both surfaces map outcomes to their
 * own error vocabulary (route → HTTP, tool → tool error).
 */
export async function moveTaskToBoard(
  store: TaskStore,
  agentStore: ExecutionAgentBindingReleaser | undefined,
  taskId: string,
  boardId: string,
): Promise<MoveTaskToBoardResult> {
  const task = await store.getTask(taskId);
  if (!task) {
    return { ok: false, code: "task-not-found", message: `Task ${taskId} not found` };
  }

  const boardStore = store.getBoardStore();
  const targetBoard = boardStore.getBoard(boardId);
  if (!targetBoard) {
    return { ok: false, code: "board-not-found", message: `Board ${boardId} not found` };
  }

  const fromBoardId = task.boardId ?? null;
  if (fromBoardId === boardId) {
    // Already homed on the target board — no-op, return current state.
    return { ok: true, noop: true, task, fromBoardId, toBoardId: boardId, board: targetBoard };
  }

  // Abort any active session and release execution-agent bindings (the task
  // restarts under the target board's Lead). Same primitive the reset path uses.
  await releaseExecutionAgentBindings(agentStore, taskId);

  // Re-home the task onto the target board.
  store.setTaskBoard(taskId, boardId);

  // Move it to the target board's todo as a SYSTEM action. `bypassGuards` +
  // `moveSource: "engine"` skip the human/agent movement matrix so the re-home
  // is never rejected by the company-model drag rules.
  await store.moveTask(taskId, "todo", {
    moveSource: "engine",
    bypassGuards: true,
  });

  await store.logEntry(
    taskId,
    `Task moved to board "${targetBoard.name}" — re-homed to its Todo; any active session aborted`,
    JSON.stringify({ fromBoardId, toBoardId: boardId }),
  );

  const updated = await store.getTask(taskId);
  if (!updated) {
    return { ok: false, code: "task-not-found", message: `Task ${taskId} not found after move-to-board` };
  }
  return { ok: true, noop: false, task: updated, fromBoardId, toBoardId: boardId, board: targetBoard };
}

export type DeleteBoardResult =
  | { ok: true; deletedBoardId: string; rehomedToBoardId: string | null; rehomedTaskIds: string[] }
  | {
      ok: false;
      code:
        | "board-not-found"
        | "default-homes-null-tasks"
        | "no-rehome-target"
        | "rehome-failed";
      message: string;
    };

/**
 * Delete a board (U10 follow-up): re-home the board's tasks to the project's
 * DEFAULT board (a SYSTEM action — bypasses the human movement matrix, releases
 * each task's execution-agent bindings, lands it on the default board's Todo),
 * then delete the board row and let the BoardStore emit `board:deleted`.
 *
 * Refusals:
 *  - the board does not exist;
 *  - deleting the DEFAULT board while it still homes `boardId = null` tasks
 *    (those tasks count on the default board and have nowhere to re-home — the
 *    default board is the universal fallback, so removing it would orphan them);
 *  - there is no other board to re-home onto (a single-board project).
 *
 * Re-homing reuses {@link moveTaskToBoard} so the per-task sequence (release
 * bindings → setTaskBoard → SYSTEM move to Todo → log) is byte-identical to the
 * move-to-board route, plus one summary log entry on completion. The board's
 * own column-agent bindings live in its workflow IR, which is discarded with the
 * board; the per-task execution bindings are released by the re-home.
 */
export async function deleteBoardAndRehome(
  store: TaskStore,
  agentStore: ExecutionAgentBindingReleaser | undefined,
  boardId: string,
): Promise<DeleteBoardResult> {
  const boardStore = store.getBoardStore();
  const board = boardStore.getBoard(boardId);
  if (!board) {
    return { ok: false, code: "board-not-found", message: `Board ${boardId} not found` };
  }

  const defaultBoard = boardStore.getDefaultBoard();
  const isDefault = defaultBoard?.id === boardId;

  // The default board homes `boardId = null` tasks. If we are deleting the
  // default board and any such task exists, there is no fallback for them.
  const allTasks = await store.listTasks({ slim: true, includeArchived: true });
  const homedHere = allTasks.filter((t) => t.boardId === boardId);
  const nullHomedCount = isDefault ? allTasks.filter((t) => !t.boardId).length : 0;
  if (isDefault && nullHomedCount > 0) {
    return {
      ok: false,
      code: "default-homes-null-tasks",
      message: `Cannot delete the default board while ${nullHomedCount} task(s) home on it implicitly (boardId = null)`,
    };
  }

  // Re-home this board's explicitly-homed tasks onto another board: the project
  // default, or — when we are deleting the default itself — the next board.
  let target = isDefault
    ? boardStore.listBoards().find((b) => b.id !== boardId)
    : defaultBoard;
  // Fallback: if no default resolved (and we are not the default), pick any other.
  if (!target) target = boardStore.listBoards().find((b) => b.id !== boardId);
  if (homedHere.length > 0 && !target) {
    return {
      ok: false,
      code: "no-rehome-target",
      message: `Cannot delete board ${boardId}: no other board to re-home its ${homedHere.length} task(s) onto`,
    };
  }

  const rehomedTaskIds: string[] = [];
  const failedTaskIds: string[] = [];
  if (target) {
    for (const task of homedHere) {
      // moveTaskToBoard logs a per-task re-home entry (and releases the task's
      // execution-agent bindings) — that is the per-task log the issue calls for.
      try {
        // eslint-disable-next-line no-await-in-loop
        const moved = await moveTaskToBoard(store, agentStore, task.id, target.id);
        if (moved.ok) rehomedTaskIds.push(task.id);
        else failedTaskIds.push(task.id);
      } catch {
        // A concurrent delete (getTask throws) or any store error during a single
        // task's re-home must not abort the loop or, worse, fall through to the
        // board delete. Record it; the post-loop re-check decides the outcome.
        failedTaskIds.push(task.id);
      }
    }
  }

  // Re-home safety: a {ok:false} move (e.g. a task concurrently deleted, or any
  // store rejection) must NOT be silently ignored — deleting the board anyway
  // would leave that task pointing at a now-gone boardId (orphaned reference).
  // Re-check which tasks STILL home on this board after the loop; if any remain,
  // abort with a typed failure and leave the board intact for a retry.
  if (failedTaskIds.length > 0) {
    const after = await store.listTasks({ slim: true, includeArchived: true });
    const stillHomed = after.filter((t) => t.boardId === boardId).map((t) => t.id);
    if (stillHomed.length > 0) {
      return {
        ok: false,
        code: "rehome-failed",
        message:
          `Cannot delete board ${boardId}: failed to re-home ${stillHomed.length} ` +
          `task(s) (${stillHomed.join(", ")}); board left intact`,
      };
    }
  }

  // Delete the board row (guarded internally: re-homing cleared its tasks first,
  // so countTasks is 0). The BoardStore emits `board:deleted`.
  boardStore.deleteBoard(boardId);

  return {
    ok: true,
    deletedBoardId: boardId,
    rehomedToBoardId: target?.id ?? null,
    rehomedTaskIds,
  };
}

/**
 * Reject a task's plan (R20 plan-approval hold): log the rejection, clear status
 * to return the task to the Lead/triage re-spec scan, and remove PROMPT.md to
 * force regeneration. The caller must verify the task is `awaiting-approval`
 * first. Returns the refreshed task.
 *
 * Byte-identical to the reject-plan route's inline sequence; the route now
 * calls this.
 */
export async function rejectPlanForTask(store: TaskStore, taskId: string): Promise<Task> {
  // Log the rejection. The task stays in its current column (legacy: triage;
  // company-model: the Lead column / todo); clearing status returns it to the
  // Lead/triage scan, which re-specifies after the PROMPT.md is removed below.
  await store.logEntry(taskId, "Plan rejected by user", "Specification will be regenerated");

  // Clear status to return to normal Lead/triage re-spec state.
  await store.updateTask(taskId, { status: undefined });

  // Remove PROMPT.md to force regeneration.
  const { rm } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const promptPath = join(store.getRootDir(), ".fusion", "tasks", taskId, "PROMPT.md");
  await rm(promptPath, { force: true });

  return store.getTask(taskId);
}

/**
 * Resolve an AgentStore for seeding: prefer a caller-supplied live store; fall
 * back to a freshly-initialized one over the project's fusion dir. Mirrors the
 * boards route's `resolveAgentStore`.
 */
async function resolveSeedAgentStore(store: TaskStore, provided?: AgentStore): Promise<AgentStore> {
  if (provided) return provided;
  const agentStore = new AgentStore({ rootDir: store.getFusionDir() });
  await agentStore.init();
  return agentStore;
}

export interface CreateBoardWithTeamInput {
  name: string;
  description?: string;
  /** Built-in or board-owned workflow id the board initially points at. */
  workflowId: string;
  requirePlanApproval: boolean;
  lfgMode: boolean;
}

export interface CreateBoardWithTeamResult {
  board: Board;
  seeded: boolean;
}

/**
 * Create a board and seed its team (R8: born staffed). The team seed is
 * flag-gated + idempotent inside `seedBoardTeamForBoard`, so this degrades to
 * "board created, no team" when the company-model flag is off. A seed failure is
 * non-fatal (the board still exists); `seeded` reports whether any role landed.
 *
 * Extracted from the POST /boards route's create+seed sequence so the route and
 * fn_board_create share it. The route keeps ownership of the board-type registry
 * (plugin gating, template IR) and passes the resolved workflow id in.
 */
export async function createBoardWithTeam(
  store: TaskStore,
  input: CreateBoardWithTeamInput,
  options?: { agentStore?: AgentStore; onSeedError?: (err: unknown) => void },
): Promise<CreateBoardWithTeamResult> {
  const board = store.getBoardStore().createBoard({
    name: input.name,
    description: input.description ?? "",
    workflowId: input.workflowId,
    requirePlanApproval: input.requirePlanApproval,
    lfgMode: input.lfgMode,
  });

  let seeded = false;
  try {
    const settings = await store.getSettings();
    const agentStore = await resolveSeedAgentStore(store, options?.agentStore);
    const roleMap = await seedBoardTeamForBoard({ taskStore: store, agentStore, settings, boardId: board.id });
    seeded = Object.keys(roleMap).length > 0;
  } catch (seedErr) {
    options?.onSeedError?.(seedErr);
  }

  const created = store.getBoardStore().getBoard(board.id) ?? board;
  return { board: created, seeded };
}

export interface ConvertBoardPreviewResult {
  boardId: string;
  mappings: ConformColumnMapping[];
}

/**
 * Preview the R17 conform mapping for a board's current workflow. Read-only.
 * Extracted from GET /boards/:id/convert-preview.
 */
export async function previewBoardConvertToSimple(
  store: TaskStore,
  boardId: string,
): Promise<ConvertBoardPreviewResult | null> {
  const board = store.getBoardStore().getBoard(boardId);
  if (!board) return null;
  const ir = await resolveWorkflowIrById(store, board.workflowId);
  const plan = buildCompanyConformPlan(ir);
  return { boardId: board.id, mappings: plan.mappings };
}

export interface ConvertBoardApplyResult {
  board: Board;
  seeded: boolean;
  mappings: ConformColumnMapping[];
}

/**
 * Apply the R17 conform mapping: persist the conformed company workflow as a
 * board-owned definition, re-point the board at it, then re-seed the team.
 * Extracted from POST /boards/:id/convert-to-simple.
 */
export async function convertBoardToSimple(
  store: TaskStore,
  boardId: string,
  options?: { agentStore?: AgentStore; onSeedError?: (err: unknown) => void },
): Promise<ConvertBoardApplyResult | null> {
  const board = store.getBoardStore().getBoard(boardId);
  if (!board) return null;

  const ir = await resolveWorkflowIrById(store, board.workflowId);
  const plan = buildCompanyConformPlan(ir);

  const def = await store.createWorkflowDefinition({
    name: `${board.name} — simple`,
    description: `Conformed to the company template (convert-to-simple, R17).`,
    ir: plan.conformedIr,
  });
  store.getBoardStore().updateBoard(board.id, { workflowId: def.id });

  // Re-map in-flight tasks' columns onto the conformed ids (R17). Without this a
  // task sitting in a source column whose id changed under the conform (a `wip`
  // column → `in-progress`, an unclassifiable column carried under a de-collided
  // `-custom` id) would be stranded in a column the new IR no longer defines —
  // limbo the board can never render or move it out of. The map mirrors the
  // one-shot migration's column rewrite; carried columns whose id is UNCHANGED
  // (toColumnId === null) need no rewrite and are omitted.
  const columnMap: Record<string, string> = {};
  for (const m of plan.mappings) {
    if (m.toColumnId && m.toColumnId !== m.fromColumnId) {
      columnMap[m.fromColumnId] = m.toColumnId;
    }
  }
  if (Object.keys(columnMap).length > 0) {
    store.conformTaskColumns(board.id, columnMap);
  }

  let seeded = false;
  try {
    const settings = await store.getSettings();
    const agentStore = await resolveSeedAgentStore(store, options?.agentStore);
    await seedBoardTeam({ taskStore: store, agentStore, settings });
    const roleMap = await seedBoardTeamForBoard({ taskStore: store, agentStore, settings, boardId: board.id });
    seeded = Object.keys(roleMap).length > 0;
  } catch (seedErr) {
    options?.onSeedError?.(seedErr);
  }

  const updated = store.getBoardStore().getBoard(board.id) ?? board;
  return { board: updated, seeded, mappings: plan.mappings };
}

// Settings is imported for type-completeness of callers that thread it through.
export type { Settings };
