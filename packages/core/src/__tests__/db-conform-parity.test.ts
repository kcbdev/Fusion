/**
 * Classification PARITY guard (company-model U1).
 *
 * Two code paths classify a workflow column's trait ids onto a company-template
 * column id:
 *   1. the FROZEN one-shot lanes→boards migration
 *      (`classifyMigrationColumnToCompanyColumnId`, db.ts), and
 *   2. the on-demand "convert to simple" planner (`classifyColumn`,
 *      company-conform.ts), which `buildCompanyConformPlan` drives.
 *
 * They are deliberate DUPLICATES: a database migration must stay deterministic
 * and immutable for all historical DBs, so it cannot import the live, evolving
 * conform module (a future change there would silently alter how an old DB
 * migrates). This test asserts the two classifiers produce identical column-id
 * mappings across a matrix of representative columns — every trait kind the rule
 * branches on, multi-trait precedence, and unclassifiable (carried) columns — so
 * any drift surfaces at CI time and must be reconciled deliberately.
 *
 * The role annotation that `classifyColumn` adds is intentionally NOT compared:
 * the migration has no notion of roles. Only the trait-id → column-id mapping is
 * the shared contract.
 */

import { describe, it, expect } from "vitest";
import { classifyMigrationColumnToCompanyColumnId, classifyColumn } from "../index.js";

/** Representative trait-id sets covering every branch + precedence + the empty
 *  (unclassifiable / carried) case. */
const TRAIT_SET_MATRIX: ReadonlyArray<{ name: string; traits: string[] }> = [
  { name: "archived", traits: ["archived"] },
  { name: "complete", traits: ["complete"] },
  { name: "merge-blocker", traits: ["merge-blocker"] },
  { name: "human-review", traits: ["human-review"] },
  { name: "wip", traits: ["wip"] },
  { name: "intake", traits: ["intake"] },
  { name: "hold", traits: ["hold"] },
  // Unclassifiable → carried as custom (no rewrite).
  { name: "no traits", traits: [] },
  { name: "unknown trait only", traits: ["some-plugin-trait"] },
  // Precedence: archived beats everything.
  { name: "archived + complete + wip", traits: ["archived", "complete", "wip"] },
  // Precedence: complete beats review/wip/intake.
  { name: "complete + merge-blocker", traits: ["complete", "merge-blocker"] },
  // Precedence: review beats wip/intake.
  { name: "merge-blocker + wip + intake", traits: ["merge-blocker", "wip", "intake"] },
  { name: "human-review + wip", traits: ["human-review", "wip"] },
  // Precedence: wip beats intake/hold.
  { name: "wip + intake + hold", traits: ["wip", "intake", "hold"] },
  // intake/hold collapse to the same target.
  { name: "intake + hold", traits: ["intake", "hold"] },
  // Classifiable trait alongside an unknown one still classifies.
  { name: "wip + unknown", traits: ["wip", "x-custom"] },
];

describe("classification parity: migration vs convert-to-simple", () => {
  it("the frozen migration classifier and the conform classifier agree on every column-id mapping", () => {
    for (const { name, traits } of TRAIT_SET_MATRIX) {
      const traitIds = new Set(traits);
      const migrationTarget = classifyMigrationColumnToCompanyColumnId(traitIds);
      const conformTarget = classifyColumn(traitIds).toColumnId;

      // The migration returns `undefined` for unclassifiable columns; the conform
      // planner returns `null`. Both mean "carried as a custom column" — normalize.
      const normalizedMigration = migrationTarget ?? null;
      expect(normalizedMigration, `column "${name}" (${traits.join(",") || "no traits"})`).toBe(
        conformTarget,
      );
    }
  });

  it("classifies every expected company-template target at least once across the matrix", () => {
    const seen = new Set(
      TRAIT_SET_MATRIX.map(({ traits }) =>
        classifyMigrationColumnToCompanyColumnId(new Set(traits)) ?? "(carried)",
      ),
    );
    for (const target of ["todo", "in-progress", "in-review", "done", "archived", "(carried)"]) {
      expect(seen.has(target), `matrix exercises target "${target}"`).toBe(true);
    }
  });
});
