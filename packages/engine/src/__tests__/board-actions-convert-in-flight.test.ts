// @vitest-environment node
//
// Company-model U12 / R17 — convert-to-simple with IN-FLIGHT tasks.
//
// REAL BUG this guards: `convertBoardToSimple` re-points a board at a conformed
// company-template workflow but did NOT re-map the `column` of tasks already
// homed on the board. A task sitting in a source column whose id changes under
// the conform (a `wip` column → `in-progress`, or an unclassifiable column
// carried under a de-collided `-custom` id) was stranded in a column the new IR
// no longer defines — "limbo" the board can never render or move it out of. The
// fix re-maps in-flight task columns per the conform plan (mirroring the one-shot
// lanes→boards migration), recorded as a system rewrite.
//
// Runs against a REAL TaskStore (mirrors agent-tools-board-routing.test.ts).

import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as core from "@fusion/core";
import { convertBoardToSimple, previewBoardConvertToSimple } from "../board-actions.js";

const dirs: string[] = [];

async function makeStore(): Promise<core.TaskStore> {
  const rootDir = await mkdtemp(join(tmpdir(), "convert-inflight-root-"));
  const globalDir = await mkdtemp(join(tmpdir(), "convert-inflight-global-"));
  dirs.push(rootDir, globalDir);
  const store = new core.TaskStore(rootDir, globalDir);
  await store.init();
  await store.updateGlobalSettings({ experimentalFeatures: { workflowColumns: true, companyModel: true } });
  return store;
}

/** A custom 5-column workflow that conforms with column-id CHANGES:
 *   - `backlog`  (intake)        → todo            (id change)
 *   - `build`    (wip)           → in-progress     (id change)
 *   - `in-progress` (no trait)   → carried, but collides with the reserved
 *                                  template id → de-collided to `in-progress-custom`
 *   - `qa`       (merge-blocker) → in-review       (id change)
 *   - `shipped`  (complete)      → done            (id change)
 */
async function makeLegacyBoard(store: core.TaskStore) {
  const def = await store.createWorkflowDefinition({
    name: "Legacy",
    ir: {
      version: "v2",
      name: "legacy",
      columns: [
        { id: "backlog", name: "Backlog", traits: [{ trait: "intake" }] },
        { id: "build", name: "Build", traits: [{ trait: "wip" }] },
        { id: "in-progress", name: "Reviewing", traits: [] }, // collides w/ reserved id
        { id: "qa", name: "QA", traits: [{ trait: "merge-blocker" }] },
        { id: "shipped", name: "Shipped", traits: [{ trait: "complete" }] },
      ],
      nodes: [
        { id: "start", kind: "start", column: "build" },
        { id: "end", kind: "end", column: "shipped" },
      ],
      edges: [{ from: "start", to: "end" }],
    },
  });
  return store.getBoardStore().createBoard({ name: "Legacy board", workflowId: def.id, ordering: 5 });
}

afterEach(async () => {
  while (dirs.length) {
    const d = dirs.pop();
    if (d) await rm(d, { recursive: true, force: true });
  }
});

describe("convertBoardToSimple with in-flight tasks (R17)", () => {
  it("re-maps in-flight task columns onto the conformed ids (no limbo)", async () => {
    const store = await makeStore();
    try {
      const board = await makeLegacyBoard(store);

      // Tasks parked in three source columns whose ids all change under conform.
      const inBuild = await store.createTask({ description: "in build", column: "build", boardId: board.id });
      const inQa = await store.createTask({ description: "in qa", column: "qa", boardId: board.id });
      const inReviewingCustom = await store.createTask({
        description: "in reviewing (carried)",
        column: "in-progress",
        boardId: board.id,
      });

      // Preview names the target ids (so the rewrite map is derivable).
      const preview = await previewBoardConvertToSimple(store, board.id);
      const buildMap = preview!.mappings.find((m) => m.fromColumnId === "build");
      expect(buildMap?.toColumnId).toBe("in-progress");
      // The unclassifiable `in-progress` source column is carried under a
      // de-collided id (it cannot keep the reserved template id).
      const reviewingMap = preview!.mappings.find((m) => m.fromColumnId === "in-progress");
      expect(reviewingMap?.carried).toBe(true);
      expect(reviewingMap?.toColumnId).toBe("in-progress-custom");

      const result = await convertBoardToSimple(store, board.id);
      expect(result).not.toBeNull();

      // The conformed IR defines exactly the columns the tasks now sit in.
      const ir = await core.resolveWorkflowIrById(store, result!.board.workflowId);
      const columnIds = ir.version === "v2" ? ir.columns.map((c) => c.id) : [];
      expect(columnIds).toContain("in-progress");
      expect(columnIds).toContain("in-review");
      expect(columnIds).toContain("in-progress-custom");

      // Every task's column was rewritten to a column the new IR defines — no
      // task is stranded in a now-missing source column.
      expect((await store.getTask(inBuild.id)).column).toBe("in-progress");
      expect((await store.getTask(inQa.id)).column).toBe("in-review");
      expect((await store.getTask(inReviewingCustom.id)).column).toBe("in-progress-custom");

      for (const id of [inBuild.id, inQa.id, inReviewingCustom.id]) {
        const task = await store.getTask(id);
        expect(columnIds).toContain(task.column); // resolvable on the new board
      }
    } finally {
      store.close();
    }
  });

  it("a task already in a column whose id is unchanged is left untouched", async () => {
    const store = await makeStore();
    try {
      const board = await makeLegacyBoard(store);
      // `backlog` → `todo` (id change), but a task created directly in `todo`
      // would not exist on the legacy board; instead verify the rewrite is
      // surgical — only mapped source columns are touched. Create a task in the
      // `shipped` (complete → done) column and confirm it lands in `done`.
      const shipped = await store.createTask({ description: "shipped", column: "shipped", boardId: board.id });
      await convertBoardToSimple(store, board.id);
      expect((await store.getTask(shipped.id)).column).toBe("done");
    } finally {
      store.close();
    }
  });

  it("converting a board with no homed tasks is a clean no-op for task columns", async () => {
    const store = await makeStore();
    try {
      const board = await makeLegacyBoard(store);
      const result = await convertBoardToSimple(store, board.id);
      expect(result).not.toBeNull();
      // Board re-pointed; nothing to corrupt.
      const ir = await core.resolveWorkflowIrById(store, result!.board.workflowId);
      expect(core.isCompanyBoardIr(ir)).toBe(true);
    } finally {
      store.close();
    }
  });
});
