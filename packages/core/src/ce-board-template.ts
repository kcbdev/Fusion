/**
 * Compound Engineering board template (company-model U13, R18/R20/R22).
 *
 * The CE board is the company board template (idea → todo → in-progress →
 * in-review → done → archived, with the three locked role columns) EXTENDED so
 * each working column runs a Compound Engineering stage as its work engine, plus
 * a new locked "Compound" column between In review and Done that runs ce-compound
 * to capture learnings before shipping.
 *
 * Engine bindings (the "this column runs a CE stage" representation) ride the
 * least-invasive carrier: the per-column `engine` field on the IR
 * ({@link WorkflowColumnEngine}, kind `ce-stage`), validated by
 * {@link parseWorkflowIr}. No new node kind, store, or executor surface is
 * introduced here — engine DISPATCH (resolving the stage id → bundled skill →
 * artifact, threading LFG headless mode) is sub-part B. This unit only defines
 * the template shape, the `isCeBoardIr` predicate, the per-board defaults
 * (requirePlanApproval on, optional LFG mode), and the per-task LFG override
 * helpers.
 *
 * Column → stage map:
 *   todo        (Lead)     → ce-plan        (plan doc artifact)
 *   in-progress (Executor) → ce-work        (consumes the plan)
 *   in-review   (Reviewer) → ce-code-review (findings feed the U6 verdict)
 *   compound    (locked)   → ce-compound    (captures learnings to docs/solutions)
 *
 * PR respond loop (PR-mode boards): the respond-loop binding maps to
 * `resolve-pr-feedback` (the ce-resolve-pr-feedback stage). The board IR carries
 * it as the engine on the Reviewer column's respond region; sub-part B threads it
 * through the PR sub-graph's pr-respond node. Exposed here as a constant so the
 * dispatch seam and tests reference one source of truth.
 */

import type { WorkflowIr, WorkflowIrColumn } from "./workflow-ir-types.js";
import { parseWorkflowIr } from "./workflow-ir.js";
import { BUILTIN_WORKFLOW_SETTINGS } from "./builtin-workflow-settings.js";
import type { Task } from "./types.js";

/** The CE board's column ids in board order. Identical to the company board with
 *  the extra locked `compound` column inserted between in-review and done. */
export const CE_BOARD_COLUMN_IDS = [
  "idea",
  "todo",
  "in-progress",
  "in-review",
  "compound",
  "done",
  "archived",
] as const;

/** The CE stage id bound to a PR-mode board's respond loop (ce-resolve-pr-feedback).
 *  Sub-part B threads it through the PR sub-graph; defined here so the binding and
 *  tests share one source of truth. */
export const CE_RESPOND_LOOP_STAGE_ID = "resolve-pr-feedback";

/**
 * Map a CE board's column engine stage id (the carrier the dispatch seam reads,
 * e.g. `ce-plan` / `ce-work` / `ce-code-review` / `ce-compound`) onto the CE
 * plugin's stage REGISTRY id (`plan` / `work` / `code-review` / `compound`). The
 * board template binds the `ce-`-prefixed skill-style ids so the carrier is
 * self-describing; the plugin's `getStage`/orchestrator key off the bare registry
 * id. The PR respond-loop stage ({@link CE_RESPOND_LOOP_STAGE_ID},
 * `resolve-pr-feedback`) has no `ce-` prefix and maps to itself. Centralized here
 * so the launcher adapter and tests share one mapping. Tolerant of an already-bare
 * id (idempotent): an input without the `ce-` prefix is returned unchanged.
 */
export function resolveCePluginStageId(boardStageId: string): string {
  return boardStageId.startsWith("ce-") ? boardStageId.slice("ce-".length) : boardStageId;
}

/** The unstaffed, locked intake column before todo (R5/KTD), mirroring the
 *  company template. No `role` marker and no engine — never picked up by dispatch. */
const IDEA_COLUMN: WorkflowIrColumn = {
  id: "idea",
  name: "Idea",
  locked: true,
  traits: [{ trait: "intake" }],
};

/** The three locked role columns, each carrying a CE-stage work engine. The role
 *  markers (so U2 seeds the team and U3's movement rules fire) and the engine
 *  bindings (so dispatch runs the stage, sub-part B) coexist on the same column. */
const ROLE_COLUMNS: WorkflowIrColumn[] = [
  {
    id: "todo",
    name: "Todo",
    role: "lead",
    locked: true,
    engine: { kind: "ce-stage", stageId: "ce-plan" },
    traits: [{ trait: "hold", config: { release: "capacity" } }, { trait: "reset-on-entry" }],
  },
  {
    id: "in-progress",
    name: "In progress",
    role: "executor",
    locked: true,
    engine: { kind: "ce-stage", stageId: "ce-work" },
    traits: [{ trait: "wip" }, { trait: "abort-on-exit" }, { trait: "timing" }],
  },
  {
    id: "in-review",
    name: "In review",
    role: "reviewer",
    locked: true,
    engine: { kind: "ce-stage", stageId: "ce-code-review" },
    traits: [{ trait: "merge-blocker" }, { trait: "stall-detection" }, { trait: "merge" }],
  },
];

/** The locked Compound column between In review and Done (R18). Runs ce-compound
 *  to capture learnings to docs/solutions before the PR/Done region. No `role`
 *  marker (it is not a mandatory-role-staffing column); it carries an engine
 *  binding only. Locked so the simple-mode column editor cannot remove it. */
const COMPOUND_COLUMN: WorkflowIrColumn = {
  id: "compound",
  name: "Compound",
  locked: true,
  engine: { kind: "ce-stage", stageId: "ce-compound" },
  traits: [],
};

const TAIL_COLUMNS: WorkflowIrColumn[] = [
  { id: "done", name: "Done", traits: [{ trait: "complete" }] },
  { id: "archived", name: "Archived", traits: [{ trait: "archived" }] },
];

const RAW_CE_BOARD_TEMPLATE_IR: WorkflowIr = {
  version: "v2",
  name: "ce-board-template",
  columns: [IDEA_COLUMN, ...ROLE_COLUMNS, COMPOUND_COLUMN, ...TAIL_COLUMNS],
  // Node graph: the canonical execute → review → merge seam pipeline (identical
  // to the company template, so it compiles onto the linear WorkflowStep engine)
  // plus a single post-merge `compound` prompt step that runs ce-compound after
  // the merge boundary and before done. The `compound` node is a regular
  // (non-seam) post-merge node with EXACTLY ONE outgoing edge to `end`: like
  // every other user step it relies on the standard step-failure handling rather
  // than an explicit failure edge (a non-seam node with two edges would "branch"
  // and force the deferred interpreter — see workflow-compiler.validateLinearity).
  // The CE-stage engine binding the dispatch seam reads rides the COLUMN
  // (`resolveCeStageForColumn`), not the node, so the compound column still runs
  // ce-compound at dispatch regardless of how its node compiles.
  nodes: [
    { id: "start", kind: "start", column: "todo" },
    { id: "execute", kind: "prompt", column: "in-progress", config: { seam: "execute" } },
    { id: "review", kind: "prompt", column: "in-review", config: { seam: "review" } },
    { id: "merge", kind: "prompt", column: "in-review", config: { seam: "merge" } },
    { id: "compound", kind: "prompt", column: "compound", config: { seam: "compound" } },
    { id: "end", kind: "end", column: "done" },
  ],
  edges: [
    { from: "start", to: "execute" },
    { from: "execute", to: "review", condition: "success" },
    { from: "review", to: "merge", condition: "success" },
    { from: "merge", to: "compound", condition: "success" },
    { from: "compound", to: "end", condition: "success" },
    { from: "execute", to: "end", condition: "failure" },
    { from: "review", to: "end", condition: "failure" },
    { from: "merge", to: "end", condition: "failure" },
  ],
  settings: BUILTIN_WORKFLOW_SETTINGS,
};

/** The Compound Engineering board template. Built on the company template (so it
 *  is a company-model board: role markers present, U2/U3 fire) with CE-stage
 *  engine bindings and the extra Compound column. */
export const CE_BOARD_TEMPLATE_IR = parseWorkflowIr(RAW_CE_BOARD_TEMPLATE_IR);

/** The board-type defaults for a Compound Engineering board (R20/R22). Plan
 *  approval is ON by default; LFG mode is OFF by default (opt-in per board, with
 *  per-task override). */
export const CE_BOARD_DEFAULTS = {
  requirePlanApproval: true,
  lfgMode: false,
} as const;

/**
 * True when an IR is a Compound Engineering board — i.e. at least one column
 * carries a `ce-stage` work-engine binding. This is the authority for "is this a
 * CE board" used by the dispatch seam (sub-part B) to decide whether to resolve a
 * CE stage engine for a column. A CE board is also a company board
 * (`isCompanyBoardIr` is true), but the converse does not hold — a plain company
 * board has role markers without engine bindings.
 */
export function isCeBoardIr(ir: WorkflowIr): boolean {
  if (ir.version !== "v2") return false;
  return ir.columns.some((c) => c.engine?.kind === "ce-stage");
}

/**
 * The CE stage id a column runs, or undefined when the column has no CE-stage
 * engine binding. The least-invasive read accessor over the IR `engine` field,
 * used by the dispatch seam (sub-part B) and tests so the carrier representation
 * is read in one place.
 */
export function resolveCeStageForColumn(ir: WorkflowIr, columnId: string): string | undefined {
  if (ir.version !== "v2") return undefined;
  const col = ir.columns.find((c) => c.id === columnId);
  return col?.engine?.kind === "ce-stage" ? col.engine.stageId : undefined;
}

/**
 * Reserved per-task `customFields` key carrying the LFG-mode override for a task
 * on a CE board (R22). LFG mode is a per-board default (Board.lfgMode) overridable
 * per task; the override is stored on the task's existing opaque `customFields`
 * JSON column (already round-tripped by the store) rather than a new tasks-table
 * column — no schema change for the per-task piece. Tri-state: `true`/`false`
 * override the board default; absent/`undefined` inherits the board. Engine
 * consumption (resolving the effective posture at dispatch) is sub-part B; these
 * helpers are the single read/write seam so the engine and UI never reach into
 * the raw key.
 *
 * Namespaced with a `__` prefix so it cannot collide with a workflow-defined
 * custom field id (those are kebab/identifier ids; `__` is reserved for engine
 * internals).
 */
export const TASK_LFG_OVERRIDE_KEY = "__lfgMode";

/** Read a task's LFG override (R22). Returns the explicit boolean override, or
 *  undefined when the task inherits the board default. Tolerant of a missing /
 *  malformed customFields bag. */
export function getTaskLfgOverride(task: Pick<Task, "customFields">): boolean | undefined {
  const raw = task.customFields?.[TASK_LFG_OVERRIDE_KEY];
  return typeof raw === "boolean" ? raw : undefined;
}

/**
 * Resolve the effective LFG posture for a task on a board (R22): the per-task
 * override when set, otherwise the board's `lfgMode` default. Engine dispatch
 * (sub-part B) consults this to decide headless-vs-interactive; defined here so
 * the resolution lives next to the carrier.
 */
export function resolveEffectiveLfgMode(
  task: Pick<Task, "customFields">,
  boardLfgMode: boolean,
): boolean {
  const override = getTaskLfgOverride(task);
  return override ?? boardLfgMode;
}

/** Produce the `customFields` patch that sets (or clears, with `undefined`) a
 *  task's LFG override (R22). Merges onto any existing customFields so unrelated
 *  fields are preserved. Returns a new object — does not mutate the input. */
export function withTaskLfgOverride(
  customFields: Record<string, unknown> | undefined,
  override: boolean | undefined,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(customFields ?? {}) };
  if (override === undefined) {
    delete next[TASK_LFG_OVERRIDE_KEY];
  } else {
    next[TASK_LFG_OVERRIDE_KEY] = override;
  }
  return next;
}
