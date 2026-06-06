/**
 * On-demand "convert to simple mode" conform mapping (U12 sub-part A, R17).
 *
 * The lanes→boards MIGRATION (db.ts `convertLanesToBoards` / `buildColumnConformMap`)
 * conforms non-default workflows onto the company template at upgrade time. R17
 * asks for the SAME mapping on demand from project settings, with a PREVIEW the
 * user sees before applying. This module is the callable, side-effect-free core
 * that both the preview and the apply path share, so the on-demand conversion can
 * never drift from the migration's classification.
 *
 * Classification mirrors the migration exactly (trait-id based):
 *   archived                          → archived
 *   complete                          → done
 *   merge-blocker / human-review      → in-review (Reviewer)
 *   wip                               → in-progress (Executor)
 *   intake / hold                     → todo (Lead)
 *   (anything else)                   → carried as a CUSTOM column (keeps its id),
 *                                       sequenced between todo and in-review.
 *
 * The result is a {@link CompanyConformPlan}: the list of role-region column
 * rewrites plus the carried custom columns, and the conformed IR to persist. The
 * caller (a dashboard route) staffs the role columns via the U2 team seed after
 * pointing the board at the conformed workflow.
 */

import type { WorkflowIr, WorkflowIrColumn } from "./workflow-ir-types.js";
import { parseWorkflowIr, WorkflowIrError } from "./workflow-ir.js";
import { COMPANY_BOARD_TEMPLATE_IR } from "./company-board-template.js";

/**
 * Thrown when a board cannot be conformed onto the company template because a
 * carried-forward custom column is structurally invalid (e.g. a malformed agent
 * binding) and the assembled IR fails {@link parseWorkflowIr} validation.
 *
 * `buildCompanyConformPlan` re-points the raw {@link WorkflowIrError} into this
 * typed, descriptive failure so consumers (the convert-preview / convert-to-
 * simple dashboard routes via the engine board-actions) get an attributable
 * conform error message instead of a bare IR-parse throw leaking to the route's
 * generic error mapper.
 */
export class CompanyConformError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "CompanyConformError";
  }
}

/** A single source-column → company-template-column rewrite in the plan. */
export interface ConformColumnMapping {
  /** The source column id. */
  fromColumnId: string;
  /** The source column's display name (for the preview). */
  fromColumnName: string;
  /** The company-template column it maps onto, or `null` when carried as-is
   *  (a custom column keeps its own id). */
  toColumnId: string | null;
  /** The company role the target column carries (lead/executor/reviewer), or
   *  undefined for non-role targets / carried custom columns. */
  role?: "lead" | "executor" | "reviewer";
  /** True when this column is carried forward as a custom column (no rewrite). */
  carried: boolean;
}

/** The full conform plan: per-column mappings + the IR to persist on apply. */
export interface CompanyConformPlan {
  mappings: ConformColumnMapping[];
  /** The conformed company-model IR (company template + carried custom columns)
   *  ready to persist as the board's workflow. */
  conformedIr: WorkflowIr;
}

/**
 * Map a column's trait ids onto the company-template column id, or `null` when it
 * is unclassifiable (carried as a custom column), plus the company role the
 * target column carries.
 *
 * The trait-id → column-id mapping is IDENTICAL to the frozen lanes→boards
 * migration classifier (`classifyMigrationColumnToCompanyColumnId` in db.ts) —
 * the two are kept in lockstep by db-conform-parity.test.ts so the on-demand
 * "convert to simple" path and the one-shot migration can never drift. The role
 * annotation is unique to this path (the migration has no notion of roles).
 */
export function classifyColumn(traitIds: ReadonlySet<string>): {
  toColumnId: string | null;
  role?: "lead" | "executor" | "reviewer";
} {
  if (traitIds.has("archived")) return { toColumnId: "archived" };
  if (traitIds.has("complete")) return { toColumnId: "done" };
  if (traitIds.has("merge-blocker") || traitIds.has("human-review"))
    return { toColumnId: "in-review", role: "reviewer" };
  if (traitIds.has("wip")) return { toColumnId: "in-progress", role: "executor" };
  if (traitIds.has("intake") || traitIds.has("hold")) return { toColumnId: "todo", role: "lead" };
  return { toColumnId: null };
}

function traitIdSet(col: WorkflowIrColumn): Set<string> {
  return new Set((col.traits ?? []).map((t) => t.trait).filter((t): t is string => Boolean(t)));
}

/**
 * Build the on-demand conform plan for a legacy/advanced board's workflow IR.
 *
 * The returned `conformedIr` is the company template with the source workflow's
 * UNCLASSIFIABLE columns carried forward as custom columns, inserted between the
 * Executor (in-progress) and Reviewer (in-review) columns — the legal placement
 * region (R2). Role columns and the idea/done/archived tail come from the
 * company template verbatim (locked, role-marked), so the result is always a
 * valid simple-mode board (never degraded).
 *
 * A board already built on the company template (its IR carries role markers)
 * yields an empty rewrite set and the template IR — applying is a safe no-op
 * beyond re-seeding the team.
 */
export function buildCompanyConformPlan(ir: WorkflowIr): CompanyConformPlan {
  const v2 = ir.version === "v2" ? ir : undefined;
  const sourceColumns = v2?.columns ?? [];

  const mappings: ConformColumnMapping[] = [];
  const carried: WorkflowIrColumn[] = [];
  const reservedIds = new Set<string>(["idea", "todo", "in-progress", "in-review", "done", "archived"]);

  for (const col of sourceColumns) {
    const { toColumnId, role } = classifyColumn(traitIdSet(col));
    if (toColumnId) {
      mappings.push({
        fromColumnId: col.id,
        fromColumnName: col.name,
        toColumnId,
        role,
        carried: false,
      });
    } else {
      // Carried custom column. Avoid colliding with a reserved template id by
      // suffixing; keep a stable derived id so re-running is deterministic.
      let carriedId = col.id;
      while (reservedIds.has(carriedId)) carriedId = `${carriedId}-custom`;
      reservedIds.add(carriedId);
      carried.push({
        id: carriedId,
        name: col.name,
        traits: col.traits ?? [],
        ...(col.agent ? { agent: col.agent } : {}),
      });
      mappings.push({
        fromColumnId: col.id,
        fromColumnName: col.name,
        toColumnId: carriedId === col.id ? null : carriedId,
        carried: true,
      });
    }
  }

  // Assemble the conformed IR: company template, with carried custom columns
  // inserted between in-progress and in-review (the legal custom-column region).
  const template = COMPANY_BOARD_TEMPLATE_IR;
  if (template.version !== "v2") {
    // Defensive: the template is always v2.
    return { mappings, conformedIr: template };
  }

  const conformedColumns: WorkflowIrColumn[] = [];
  for (const col of template.columns) {
    conformedColumns.push(col);
    if (col.id === "in-progress" && carried.length > 0) {
      conformedColumns.push(...carried);
    }
  }

  // A carried custom column can carry a structurally invalid agent binding that
  // only fails validation once re-assembled with the template. parseWorkflowIr
  // throws WorkflowIrError in that case; left unhandled it would propagate raw
  // through the engine board-actions to the dashboard route. Re-point it into a
  // typed, descriptive CompanyConformError so the failure is attributable to the
  // conform (bad carried column) rather than surfacing as an opaque IR throw.
  let conformedIr: WorkflowIr;
  try {
    conformedIr = parseWorkflowIr({
      ...template,
      name: "company-board-conformed",
      columns: conformedColumns,
    });
  } catch (err) {
    if (err instanceof WorkflowIrError) {
      throw new CompanyConformError(
        `Cannot conform board to the company template: a carried custom column is ` +
          `structurally invalid (${err.message})`,
        err,
      );
    }
    throw err;
  }

  return { mappings, conformedIr };
}
