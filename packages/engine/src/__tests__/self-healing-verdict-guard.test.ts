// @vitest-environment node
//
// Company-model U7 — the self-healing mergeable-in-review sweep must consult the
// auto-merge chokepoint so it never re-enqueues a verdict-pending company task
// (route `blocked`) or a PR-mode task (route `pr-subgraph`) into the legacy merge
// queue (plan U7 test scenarios: "Self-healing sweep does not enqueue a
// verdict-pending in-review task; does re-process it after pass").
//
// REAL BUG this guards: `SelfHealingManager.recoverMergeableReviewTasks` filtered
// only by the verdict-UNAWARE `allowsAutoMergeProcessing` boolean, so on a flag-on
// company board it would enqueue a verdict-pending in-review task that happened to
// retain its worktree — merging unreviewed work. The fix threads the
// `autoMergeGate` chokepoint into the sweep (additive: legacy/non-company boards
// route `auto-enqueue`, so behavior is byte-identical there).
//
// Uses a REAL flag-on TaskStore + a staffed company-template workflow + the real
// ReviewerGate + a real `resolveAutoMergeRoute` gate, with the merge enqueue
// stubbed (we assert WHICH task ids the sweep tries to enqueue).

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  TaskStore,
  parseWorkflowIr,
  COMPANY_BOARD_TEMPLATE_IR,
  type WorkflowIr,
  type WorkflowIrColumn,
} from "@fusion/core";
import { SelfHealingManager } from "../self-healing.js";
import { resolveAutoMergeRoute } from "../auto-merge-gate-engine.js";
import { ReviewerGate, type ReviewerEvaluator } from "../reviewer-gate.js";

const LEAD = "agent-lead";
const EXECUTOR = "agent-executor";
const REVIEWER = "agent-reviewer";

function makeTmpDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function staffedCompanyIr(template: WorkflowIr): WorkflowIr {
  if (template.version !== "v2") throw new Error("expected v2");
  const columns: WorkflowIrColumn[] = template.columns.map((c) => {
    if (c.role === "lead") return { ...c, agent: { agentId: LEAD, mode: "defer" as const } };
    if (c.role === "executor") return { ...c, agent: { agentId: EXECUTOR, mode: "defer" as const } };
    if (c.role === "reviewer") return { ...c, agent: { agentId: REVIEWER, mode: "defer" as const } };
    return c;
  });
  return parseWorkflowIr({ ...template, columns });
}

const passEvaluator: ReviewerEvaluator = async () => ({ status: "pass", summary: "all good" });

describe("self-healing mergeable-in-review sweep consults the verdict gate (U7)", () => {
  let rootDir: string;
  let globalDir: string;
  let store: TaskStore;
  let companyWorkflowId: string;
  let enqueued: string[];
  let manager: SelfHealingManager;

  async function setup(): Promise<void> {
    rootDir = makeTmpDir("kb-sh-verdict-");
    globalDir = makeTmpDir("kb-sh-verdict-global-");
    store = new TaskStore(rootDir, globalDir, { inMemoryDb: true });
    await store.init();
    await store.updateGlobalSettings({
      experimentalFeatures: { workflowColumns: true, companyModel: true },
      // autoMerge defaults true; keep it on so the legacy gate would have admitted.
    });
    companyWorkflowId = (
      await store.createWorkflowDefinition({ name: "company", ir: staffedCompanyIr(COMPANY_BOARD_TEMPLATE_IR) })
    ).id;
    enqueued = [];
    manager = new SelfHealingManager(store, {
      rootDir,
      enqueueMerge: (taskId: string) => {
        enqueued.push(taskId);
        return true;
      },
      autoMergeGate: (taskId: string) => resolveAutoMergeRoute({ store }, taskId),
    });
  }

  /** Create a company task, walk it (agent adjacent-forward) to in-review, and
   *  give it a worktree so the merge-eligibility filter admits it. */
  async function inReviewTaskWithWorktree(): Promise<string> {
    const task = await store.createTask({ description: "company task" });
    await store.selectTaskWorkflowAndReconcile(task.id, companyWorkflowId);
    for (const target of ["todo", "in-progress", "in-review"]) {
      await store.moveTask(task.id, target, { moveSource: "user", actor: { kind: "agent", agentId: EXECUTOR } });
    }
    await store.updateTask(task.id, { worktree: join(rootDir, ".worktrees", task.id) });
    return task.id;
  }

  beforeEach(setup);
  afterEach(async () => {
    manager.stop();
    store.close();
    await rm(rootDir, { recursive: true, force: true });
    await rm(globalDir, { recursive: true, force: true });
  });

  it("does NOT enqueue a verdict-pending in-review company task", async () => {
    const id = await inReviewTaskWithWorktree();
    // No verdict driven yet → gate route is `blocked`.
    expect((await resolveAutoMergeRoute({ store }, id)).route).toBe("blocked");

    const recovered = await manager.recoverMergeableReviewTasks();
    expect(recovered).toBe(0);
    expect(enqueued).toEqual([]);
  });

  it("DOES re-process the task after a passing verdict lands", async () => {
    const id = await inReviewTaskWithWorktree();
    const gate = new ReviewerGate({ store, evaluate: passEvaluator });
    expect((await gate.driveReviewForTask(id)).outcome).toBe("passed");
    expect((await resolveAutoMergeRoute({ store }, id)).route).toBe("auto-enqueue");

    const recovered = await manager.recoverMergeableReviewTasks();
    expect(recovered).toBe(1);
    expect(enqueued).toEqual([id]);
  });

  it("differential: in one sweep, a passed task enqueues and a pending one does not", async () => {
    const passId = await inReviewTaskWithWorktree();
    const pendingId = await inReviewTaskWithWorktree();
    await new ReviewerGate({ store, evaluate: passEvaluator }).driveReviewForTask(passId);

    const recovered = await manager.recoverMergeableReviewTasks();
    expect(recovered).toBe(1);
    expect(enqueued).toEqual([passId]);
    expect(enqueued).not.toContain(pendingId);
  });

  it("absent gate (legacy wiring) → byte-identical: the verdict-pending task IS enqueued", async () => {
    // Prove the guard is what blocks: a manager WITHOUT the gate falls back to the
    // legacy verdict-unaware behavior and enqueues the same pending task.
    const id = await inReviewTaskWithWorktree();
    const legacyEnqueued: string[] = [];
    const legacyManager = new SelfHealingManager(store, {
      rootDir,
      enqueueMerge: (taskId: string) => {
        legacyEnqueued.push(taskId);
        return true;
      },
      // no autoMergeGate
    });
    try {
      const recovered = await legacyManager.recoverMergeableReviewTasks();
      expect(recovered).toBe(1);
      expect(legacyEnqueued).toEqual([id]);
    } finally {
      legacyManager.stop();
    }
  });
});
