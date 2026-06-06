/**
 * Board-scoped board payload WIRE types (U10) — the single shared definition of
 * the `GET /tasks/board-workflows` response shape, imported by BOTH the server
 * (packages/dashboard/src/routes/board-workflows.ts) and the client
 * (packages/dashboard/app/api/legacy.ts re-exports these from `@fusion/core`).
 *
 * Before this module the shape was declared twice — once on the server (using
 * core `TraitFlags`) and once on the client (with a hand-maintained
 * `BoardWorkflowColumnFlags` 8-key subset). The two drifted (linear
 * required-vs-optional, divergent flag key sets). Defining them here once, in
 * core, makes the contract single-sourced; the client picks them up through the
 * `@fusion/core` → `core/src/types.ts` vite alias (these are re-exported from
 * `types.ts` AND `index.ts`, like `resolveUiMode`/`WorkflowFieldDefinition`).
 *
 * These are pure wire types (no logic), so they are type-only — the vite build
 * never needs to resolve them as values.
 */

import type { TraitFlags } from "./trait-types.js";
import type { WorkflowColumnRole, WorkflowFieldDefinition } from "./workflow-ir-types.js";

/** One column of a board as the client needs it: id, display name, resolved
 *  trait flags, plus the company-model role/lock markers when present. */
export interface BoardColumn {
  id: string;
  name: string;
  /** Resolved trait flags (OR-composed across the column's traits). The full
   *  core `TraitFlags` shape — the client previously carried only an 8-key
   *  subset (`BoardWorkflowColumnFlags`), now removed. */
  flags: TraitFlags;
  /** Company-model role marker (lead/executor/reviewer), present only on the
   *  locked role columns of a company-template board. */
  role?: WorkflowColumnRole;
  /** Locked (non-deletable/non-renamable) marker, present only on role columns. */
  locked?: boolean;
}

/** The team member staffing a column: the bound agent's id and (resolved) name. */
export interface BoardTeamMember {
  agentId: string;
  agentName: string;
}

/** The board-scoped slice the client renders for one board. */
export interface BoardPayload {
  /** Ordered columns from the board's workflow IR. */
  columns: BoardColumn[];
  /** columnId → staffed agent (resolved name). Empty when no column carries a
   *  binding (legacy/default boards). */
  team: Record<string, BoardTeamMember>;
  /** Ids of the (non-archived) tasks homed on this board. */
  taskIds: string[];
  /** Custom field definitions declared by the board's workflow (U13/KTD-14).
   *  Absent when the workflow declares none. */
  fields?: WorkflowFieldDefinition[];
  /**
   * Whether the board's workflow IR is a linear column chain (no split/join),
   * i.e. it satisfies the simple-mode invariant (U11). Non-linear boards render
   * read-only in simple mode with an "open in advanced editor" affordance.
   * Always present (the server always computes it).
   */
  linear: boolean;
}

/** The board index entry the switcher renders. */
export interface BoardSummary {
  id: string;
  name: string;
  description: string;
  requirePlanApproval: boolean;
  /** R22 LFG mode (company-model U13). Per-board default for headless pipeline
   *  execution; surfaced so the UI can show the toggle and resolve the per-task
   *  override. */
  lfgMode: boolean;
  ordering: number;
}

/** The full board payload: the boards index, per-board payloads, and the
 *  default board id (where null-boardId tasks home). */
export interface BoardWorkflowsPayload {
  boards: BoardSummary[];
  boardPayloads: Record<string, BoardPayload>;
  defaultBoardId: string | null;
}
