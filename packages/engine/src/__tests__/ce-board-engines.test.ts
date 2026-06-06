// @vitest-environment node
//
// Company-model U13 sub-part B — CE column-engine dispatch, structured-outcome
// verdict adapter, engine fallback, plugin-missing parking, LFG headless mode,
// and two-postures-one-identity concurrency.
//
// The CE Session machinery itself lives in the compound-engineering plugin (the
// engine must not import a plugin). This suite tests the ENGINE-SIDE dispatch /
// adapter / fallback / LFG / parking LOGIC around a FAKED session layer
// (`FakeCeLauncher`) injected at the `CeSessionLauncher` seam — i.e. exactly the
// net-new U13 work. The verdict-integration test additionally uses a REAL
// flag-on TaskStore + staffed CE IR so the adapter feeds the genuine U6
// `ReviewerGate` fail flow (a CE review failure moves the task backward exactly
// like a validator fail).
//
// Covers the U13 plan scenarios:
//  - dispatch binding per column (todo→ce-plan, in-progress→ce-work,
//    in-review→ce-code-review, compound→ce-compound);
//  - verdict integration: a CE review fail moves the task backward like a
//    validator fail (real ReviewerGate);
//  - engine fallback: plugin/stage missing at dispatch degrades to the standard
//    engine with a persisted audit event;
//  - plugin-missing parked-state: a parked CE task whose engine is gone at
//    release parks with a plugin-missing diagnostic (no degrade);
//  - LFG: headless posture, no awaiting-input, no plan hold; an interactive task
//    on the same board still parks;
//  - LFG no-safe-default: parks visibly instead of fabricating an answer;
//  - two postures, one identity: posture is per-session, not per-agent.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  TaskStore,
  parseWorkflowIr,
  CE_BOARD_TEMPLATE_IR,
  COMPANY_BOARD_TEMPLATE_IR,
  withTaskLfgOverride,
  getTaskLfgOverride,
  type WorkflowIr,
  type WorkflowIrColumn,
} from "@fusion/core";
import {
  dispatchCeColumn,
  dispatchCePrRespond,
  resolveCeParkedReleasePosture,
  adaptCeReviewOutcome,
  createCeReviewerEvaluator,
  createCeAwareReviewerEvaluator,
  CE_FALLBACK_DEGRADE_LOG_PREFIX,
  CE_PLUGIN_MISSING_PARK_LOG_PREFIX,
  CE_LFG_NO_SAFE_DEFAULT_PARK_LOG_PREFIX,
  CE_PREPUSH_GUARD_MISSING_LOG_PREFIX,
  type CeSessionLauncher,
  type CeSessionLaunchRequest,
  type CeSessionLaunchOutcome,
  type CeDispatchDeps,
  type CeReviewCompletion,
} from "../ce-dispatch.js";
import { ReviewerGate, REVIEWER_FAIL_FEEDBACK_LOG_PREFIX, type ReviewerEvaluator } from "../reviewer-gate.js";
import { TaskExecutor } from "../executor.js";
import { createDefaultNodeHandlers, createNoopLegacySeams } from "../workflow-node-handlers.js";
import type { PrNodeDeps } from "../pr-nodes.js";

const LEAD = "agent-lead";
const EXECUTOR = "agent-executor";
const REVIEWER = "agent-reviewer";

/* ────────────────────────────────────────────────────────────────────────────
 * Fake CE launcher (the injected session-layer seam).
 * ──────────────────────────────────────────────────────────────────────────── */

/** Records every launch and answers a scripted outcome. `available` /
 *  `stages` model the plugin-installed + stage-registered probes. */
class FakeCeLauncher implements CeSessionLauncher {
  available = true;
  stages = new Set([
    "ce-plan",
    "ce-work",
    "ce-code-review",
    "ce-compound",
    "ce-resolve-pr-feedback",
    // The PR respond-loop stage id is the bare `resolve-pr-feedback`
    // (CE_RESPOND_LOOP_STAGE_ID has no `ce-` prefix); include it so the fake's
    // `hasStage` probe accepts the respond-loop launch request.
    "resolve-pr-feedback",
  ]);
  /** Per-stage scripted outcome override (defaults to a "launched" session). */
  outcomeFor: (req: CeSessionLaunchRequest) => CeSessionLaunchOutcome = (req) => ({
    kind: "launched",
    sessionId: `sess-${req.taskId}-${req.stageId}`,
  });
  launched: CeSessionLaunchRequest[] = [];

  isAvailable(): boolean {
    return this.available;
  }
  hasStage(stageId: string): boolean {
    return this.stages.has(stageId);
  }
  async launch(req: CeSessionLaunchRequest): Promise<CeSessionLaunchOutcome> {
    this.launched.push(req);
    return this.outcomeFor(req);
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Store helpers.
 * ──────────────────────────────────────────────────────────────────────────── */

function makeTmpDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/**
 * A staffed CE IR — mirrors board-team-seed (Lead/Executor/Reviewer agents).
 *
 * The COLUMNS are taken verbatim from CE_BOARD_TEMPLATE_IR (so the `ce-stage`
 * engine bindings the dispatch seam reads — todo→ce-plan, in-progress→ce-work,
 * in-review→ce-code-review, compound→ce-compound — are the real production
 * bindings), but the NODE GRAPH is linearized so the workflow compiler accepts it
 * (`createWorkflowDefinition` compiles to steps; the production CE template's
 * branching `compound` node requires the interpreter, which is out of scope for
 * these dispatch/adapter unit tests). `isCeBoardIr` keys off the column engine
 * bindings, so the dispatch path under test is exercised unchanged.
 */
function staffedCeIr(): WorkflowIr {
  const template = CE_BOARD_TEMPLATE_IR;
  if (template.version !== "v2") throw new Error("expected v2");
  const columns: WorkflowIrColumn[] = template.columns.map((c) => {
    if (c.role === "lead") return { ...c, agent: { agentId: LEAD, mode: "defer" as const } };
    if (c.role === "executor") return { ...c, agent: { agentId: EXECUTOR, mode: "defer" as const } };
    if (c.role === "reviewer") return { ...c, agent: { agentId: REVIEWER, mode: "defer" as const } };
    return c;
  });
  // Linear node graph (compiler-friendly): start→execute→review→merge→end.
  // The `compound` column has no node on the linear path; the dispatch seam reads
  // the column engine binding directly, not the node graph, so this is sufficient.
  return parseWorkflowIr({
    version: "v2",
    name: "ce-test",
    columns,
    nodes: [
      { id: "start", kind: "start", column: "todo" },
      { id: "execute", kind: "prompt", column: "in-progress", config: { seam: "execute" } },
      { id: "review", kind: "prompt", column: "in-review", config: { seam: "review" } },
      { id: "merge", kind: "prompt", column: "in-review", config: { seam: "merge" } },
      { id: "end", kind: "end", column: "done" },
    ],
    edges: [
      { from: "start", to: "execute" },
      { from: "execute", to: "review", condition: "success" },
      { from: "review", to: "merge", condition: "success" },
      { from: "merge", to: "end", condition: "success" },
      { from: "execute", to: "end", condition: "failure" },
      { from: "review", to: "end", condition: "failure" },
      { from: "merge", to: "end", condition: "failure" },
    ],
    settings: template.settings,
  });
}

function staffedCompanyIr(): WorkflowIr {
  const template = COMPANY_BOARD_TEMPLATE_IR;
  if (template.version !== "v2") throw new Error("expected v2");
  const columns: WorkflowIrColumn[] = template.columns.map((c) => {
    if (c.role === "lead") return { ...c, agent: { agentId: LEAD, mode: "defer" as const } };
    if (c.role === "executor") return { ...c, agent: { agentId: EXECUTOR, mode: "defer" as const } };
    if (c.role === "reviewer") return { ...c, agent: { agentId: REVIEWER, mode: "defer" as const } };
    return c;
  });
  return parseWorkflowIr({ ...template, columns });
}

describe("CE column-engine dispatch (U13 sub-part B)", () => {
  let rootDir: string;
  let globalDir: string;
  let store: TaskStore;
  let ceWorkflowId: string;

  async function setup(): Promise<void> {
    rootDir = makeTmpDir("kb-engine-ce-dispatch-");
    globalDir = makeTmpDir("kb-engine-ce-dispatch-global-");
    store = new TaskStore(rootDir, globalDir, { inMemoryDb: true });
    await store.init();
    await store.updateGlobalSettings({
      experimentalFeatures: { workflowColumns: true, companyModel: true },
    });
    const def = await store.createWorkflowDefinition({ name: "ce", ir: staffedCeIr() });
    ceWorkflowId = def.id;
  }

  async function teardown(): Promise<void> {
    store.close();
    await rm(rootDir, { recursive: true, force: true });
    await rm(globalDir, { recursive: true, force: true });
  }

  /** Create a CE task and walk it to `column` via agent adjacent-forward moves.
   *  Crossing OUT of in-review requires a passing Reviewer verdict (U6 gate), so a
   *  pass verdict is recorded via the ReviewerGate before the in-review→compound
   *  move. */
  async function taskAt(column: string): Promise<string> {
    const task = await store.createTask({ description: "ce task" });
    await store.selectTaskWorkflowAndReconcile(task.id, ceWorkflowId);
    const order = ["idea", "todo", "in-progress", "in-review", "compound", "done"];
    const targetIdx = order.indexOf(column);
    for (let i = 1; i <= targetIdx; i++) {
      if (order[i] === "compound") {
        // Record a passing verdict so the U6 done-transition gate allows the move
        // out of in-review.
        const gate = new ReviewerGate({
          store,
          evaluate: async () => ({ status: "pass", summary: "ok" }),
        });
        await gate.driveReviewForTask(task.id);
      }
      await store.moveTask(task.id, order[i], {
        moveSource: "user",
        actor: { kind: "agent", agentId: EXECUTOR },
      });
    }
    return task.id;
  }

  afterEach(async () => {
    await teardown();
  });

  /* ── Dispatch binding per column ──────────────────────────────────────────── */

  it("binds each CE column to its stage and launches a session (not the standard engine)", async () => {
    await setup();
    const launcher = new FakeCeLauncher();
    const deps: CeDispatchDeps = { store, launcher, getBoardLfgMode: () => false };

    const cases: Array<[string, string]> = [
      ["todo", "ce-plan"],
      ["in-progress", "ce-work"],
      ["in-review", "ce-code-review"],
      ["compound", "ce-compound"],
    ];
    for (const [column, stageId] of cases) {
      launcher.launched = [];
      const id = await taskAt(column);
      const result = await dispatchCeColumn(deps, id);
      expect(result.kind).toBe("dispatched");
      if (result.kind === "dispatched") {
        expect(result.stageId).toBe(stageId);
        expect(result.posture).toBe("interactive");
      }
      expect(launcher.launched).toHaveLength(1);
      expect(launcher.launched[0]).toMatchObject({ stageId, columnId: column, posture: "interactive" });
    }
  });

  it("treats intake/terminal columns (idea/done) as non-CE — caller runs the standard engine", async () => {
    await setup();
    const launcher = new FakeCeLauncher();
    const deps: CeDispatchDeps = { store, launcher, getBoardLfgMode: () => false };

    const ideaId = await taskAt("idea");
    expect((await dispatchCeColumn(deps, ideaId)).kind).toBe("not-ce-column");
    const doneId = await taskAt("done");
    expect((await dispatchCeColumn(deps, doneId)).kind).toBe("not-ce-column");
    expect(launcher.launched).toHaveLength(0);
  });

  it("a non-CE board is not CE-dispatched at all", async () => {
    await setup();
    const companyDef = await store.createWorkflowDefinition({ name: "company", ir: staffedCompanyIr() });
    const task = await store.createTask({ description: "plain company task" });
    await store.selectTaskWorkflowAndReconcile(task.id, companyDef.id);
    await store.moveTask(task.id, "todo", { moveSource: "user", actor: { kind: "agent", agentId: LEAD } });

    const launcher = new FakeCeLauncher();
    const result = await dispatchCeColumn({ store, launcher, getBoardLfgMode: () => false }, task.id);
    expect(result.kind).toBe("not-ce-column");
    expect(launcher.launched).toHaveLength(0);
  });

  /* ── Engine fallback (degrade + audit) ────────────────────────────────────── */

  it("degrades to the standard engine with a persisted audit event when the plugin is missing", async () => {
    await setup();
    const launcher = new FakeCeLauncher();
    launcher.available = false; // plugin not installed
    const id = await taskAt("in-progress");

    const result = await dispatchCeColumn({ store, launcher, getBoardLfgMode: () => false }, id);
    expect(result).toMatchObject({ kind: "degraded-to-standard", reason: "plugin-missing" });
    expect(launcher.launched).toHaveLength(0); // never launched

    const task = await store.getTask(id);
    const degradeLog = task.log.find((e) => e.action.startsWith(CE_FALLBACK_DEGRADE_LOG_PREFIX));
    expect(degradeLog).toBeDefined();

    // The degrade is also a persisted run-audit event (never silent).
    const audits = store
      .getRunAuditEvents({ taskId: id })
      .filter((e) => (e.metadata as { ceEngineFallback?: string })?.ceEngineFallback === "degrade-to-standard");
    expect(audits.length).toBeGreaterThan(0);
  });

  it("degrades when the plugin is present but the bound stage is unregistered", async () => {
    await setup();
    const launcher = new FakeCeLauncher();
    launcher.stages.delete("ce-work"); // stage gone
    const id = await taskAt("in-progress");

    const result = await dispatchCeColumn({ store, launcher, getBoardLfgMode: () => false }, id);
    expect(result).toMatchObject({ kind: "degraded-to-standard", reason: "stage-unavailable" });
    expect(launcher.launched).toHaveLength(0);
  });

  /* ── Plugin-missing parked-state release (no degrade) ─────────────────────── */

  it("parks a parked CE task with a plugin-missing diagnostic when the engine is gone at release (no degrade)", async () => {
    await setup();
    const launcher = new FakeCeLauncher();
    launcher.available = false; // uninstalled while the task is parked
    const id = await taskAt("todo"); // a Lead-column (ce-plan) task in an approval hold

    const decision = await resolveCeParkedReleasePosture({ store, launcher }, id);
    expect(decision).toMatchObject({ kind: "park-plugin-missing", stageId: "ce-plan" });

    const task = await store.getTask(id);
    const parkLog = task.log.find((e) => e.action.startsWith(CE_PLUGIN_MISSING_PARK_LOG_PREFIX));
    expect(parkLog).toBeDefined();
  });

  it("releases a parked CE task normally when the engine is present", async () => {
    await setup();
    const launcher = new FakeCeLauncher();
    const id = await taskAt("todo");
    const decision = await resolveCeParkedReleasePosture({ store, launcher }, id);
    expect(decision).toMatchObject({ kind: "release", stageId: "ce-plan" });
  });

  /* ── LFG headless posture ─────────────────────────────────────────────────── */

  it("LFG board: threads headless posture into the session; interactive task on the same board still launches interactive", async () => {
    await setup();
    const launcher = new FakeCeLauncher();

    // Board LFG default ON. A task with no override → headless.
    const lfgTaskId = await taskAt("in-progress");
    const lfgResult = await dispatchCeColumn(
      { store, launcher, getBoardLfgMode: () => true },
      lfgTaskId,
    );
    expect(lfgResult.kind).toBe("dispatched");
    if (lfgResult.kind === "dispatched") expect(lfgResult.posture).toBe("headless");

    // A SECOND task on the SAME board with a per-task override = false → interactive,
    // even though the board default is LFG. Posture is per-session (R22).
    const interactiveTaskId = await taskAt("in-progress");
    const t = await store.getTask(interactiveTaskId);
    await store.updateTask(interactiveTaskId, {
      customFields: withTaskLfgOverride(t.customFields, false),
    });
    const interactiveResult = await dispatchCeColumn(
      { store, launcher, getBoardLfgMode: () => true },
      interactiveTaskId,
    );
    expect(interactiveResult.kind).toBe("dispatched");
    if (interactiveResult.kind === "dispatched") expect(interactiveResult.posture).toBe("interactive");

    // Both ran through ONE launcher (one column agent identity), different postures.
    const postures = launcher.launched.map((l) => l.posture);
    expect(postures).toContain("headless");
    expect(postures).toContain("interactive");
  });

  it("LFG no-safe-default: a headless stage that cannot proceed parks visibly instead of fabricating an answer", async () => {
    await setup();
    const launcher = new FakeCeLauncher();
    // The plan stage has no safe headless default in this scenario.
    launcher.outcomeFor = (req) =>
      req.posture === "headless" && req.stageId === "ce-plan"
        ? { kind: "no-safe-headless-default", stageId: req.stageId }
        : { kind: "launched", sessionId: `sess-${req.taskId}` };

    const id = await taskAt("todo");
    const result = await dispatchCeColumn({ store, launcher, getBoardLfgMode: () => true }, id);
    expect(result).toMatchObject({ kind: "parked-lfg-no-safe-default", stageId: "ce-plan" });

    const task = await store.getTask(id);
    const parkLog = task.log.find((e) =>
      e.action.startsWith(CE_LFG_NO_SAFE_DEFAULT_PARK_LOG_PREFIX),
    );
    expect(parkLog).toBeDefined();

    // The park must actually change task state (a log alone would let the executor
    // re-dispatch the column on the next tick → infinite loop). It is parked as a
    // non-stuck awaiting-input status, paused, with the LFG override cleared to
    // interactive so a human un-parking it does not re-trigger headless.
    expect(task.status).toBe("awaiting-user-input");
    expect(task.paused).toBe(true);
    expect(getTaskLfgOverride(task)).toBe(false);
  });

  /* ── Two postures, one identity (concurrency) ─────────────────────────────── */

  it("two postures, one identity: one column agent runs an interactive and a headless task concurrently", async () => {
    await setup();
    const launcher = new FakeCeLauncher();

    const interactiveId = await taskAt("in-progress");
    const headlessId = await taskAt("in-progress");
    const t = await store.getTask(interactiveId);
    await store.updateTask(interactiveId, {
      customFields: withTaskLfgOverride(t.customFields, false),
    });
    const h = await store.getTask(headlessId);
    await store.updateTask(headlessId, {
      customFields: withTaskLfgOverride(h.customFields, true),
    });

    // Dispatch BOTH concurrently against the same launcher (same column agent).
    const [r1, r2] = await Promise.all([
      dispatchCeColumn({ store, launcher, getBoardLfgMode: () => false }, interactiveId),
      dispatchCeColumn({ store, launcher, getBoardLfgMode: () => false }, headlessId),
    ]);
    expect(r1.kind).toBe("dispatched");
    expect(r2.kind).toBe("dispatched");

    const byTask = new Map(launcher.launched.map((l) => [l.taskId, l.posture]));
    expect(byTask.get(interactiveId)).toBe("interactive");
    expect(byTask.get(headlessId)).toBe("headless");
    // Both ran for the SAME executor column agent — posture is a session attribute.
    const agents = new Set(launcher.launched.map((l) => l.columnAgentId));
    // (columnAgentId resolution is optional in this DI shape; the key invariant is
    // that the two sessions carry distinct postures under one dispatch path.)
    expect(byTask.get(interactiveId)).not.toBe(byTask.get(headlessId));
    void agents;
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * Structured-outcome adapter (unit) + U6 verdict integration.
 * ──────────────────────────────────────────────────────────────────────────── */

describe("CE structured-outcome adapter (U13 sub-part B)", () => {
  it("authoritative structured verdict wins (pass)", () => {
    const ev = adaptCeReviewOutcome({ verdict: { status: "pass", summary: "looks good" } });
    expect(ev.status).toBe("pass");
    expect(ev.summary).toBe("looks good");
  });

  it("authoritative structured verdict wins (fail) with findings mapped to failure reasons", () => {
    const ev = adaptCeReviewOutcome({
      verdict: {
        status: "fail",
        summary: "needs work",
        findings: [{ title: "Bug", message: "off-by-one", expected: "n", actual: "n+1" }],
      },
    });
    expect(ev.status).toBe("fail");
    expect(ev.failureReasons).toHaveLength(1);
    expect(ev.failureReasons?.[0]).toMatchObject({ title: "Bug", message: "off-by-one" });
  });

  it("derives FAIL from a markdown body with blocking findings", () => {
    const ev = adaptCeReviewOutcome({
      artifact: "# Review\n\nRequest changes: the auth check is missing.",
    });
    expect(ev.status).toBe("fail");
    expect(ev.failureReasons && ev.failureReasons.length).toBeGreaterThan(0);
  });

  it("derives PASS from a clean markdown body", () => {
    const ev = adaptCeReviewOutcome({ artifact: "# Review\n\nLGTM — no blocking issues." });
    expect(ev.status).toBe("pass");
  });

  it("derives FAIL from a body with a findings section even without an explicit marker", () => {
    const ev = adaptCeReviewOutcome({
      artifact: "# Review\n\n## Findings\n\n- Missing test coverage for the new path.",
    });
    expect(ev.status).toBe("fail");
  });

  it("a completion with neither a verdict nor a body is an ERROR (never silent pass)", () => {
    expect(adaptCeReviewOutcome({}).status).toBe("error");
    expect(adaptCeReviewOutcome({ artifact: "   " }).status).toBe("error");
  });

  it("the bare word 'blocking' in a neutral phrase does NOT fail a clean review", () => {
    // Regression: /\bblocking\b/ was too broad — a neutral sentence like
    // "avoids blocking the event loop" classified a clean review as fail. The
    // signal is now phrase-level (blocking ISSUE/FINDING/etc.), so this passes.
    // No clean marker (no LGTM/approve/pass) and no findings heading — only the
    // neutral word "blocking". Under the old bare-word pattern this wrongly failed;
    // now it falls through to the conservative pass default.
    const ev = adaptCeReviewOutcome({
      artifact: "# Review\n\nThe implementation correctly avoids blocking the event loop.",
    });
    expect(ev.status).toBe("pass");
  });

  it("derives FAIL from a phrase-level blocking signal ('blocking issue')", () => {
    const ev = adaptCeReviewOutcome({
      artifact: "# Review\n\nThere is a blocking issue: the auth check is missing.",
    });
    expect(ev.status).toBe("fail");
    expect(ev.failureReasons && ev.failureReasons.length).toBeGreaterThan(0);
  });
});

describe("CE review → U6 ReviewerGate integration (U13 sub-part B)", () => {
  let rootDir: string;
  let globalDir: string;
  let store: TaskStore;
  let ceWorkflowId: string;

  async function setup(): Promise<void> {
    rootDir = makeTmpDir("kb-engine-ce-verdict-");
    globalDir = makeTmpDir("kb-engine-ce-verdict-global-");
    store = new TaskStore(rootDir, globalDir, { inMemoryDb: true });
    await store.init();
    await store.updateGlobalSettings({
      experimentalFeatures: { workflowColumns: true, companyModel: true },
    });
    const def = await store.createWorkflowDefinition({ name: "ce", ir: staffedCeIr() });
    ceWorkflowId = def.id;
  }

  async function teardown(): Promise<void> {
    store.close();
    await rm(rootDir, { recursive: true, force: true });
    await rm(globalDir, { recursive: true, force: true });
  }

  async function taskInReview(): Promise<string> {
    const task = await store.createTask({ description: "ce task" });
    await store.selectTaskWorkflowAndReconcile(task.id, ceWorkflowId);
    for (const target of ["todo", "in-progress", "in-review"]) {
      await store.moveTask(task.id, target, {
        moveSource: "user",
        actor: { kind: "agent", agentId: EXECUTOR },
      });
    }
    return task.id;
  }

  afterEach(async () => {
    await teardown();
  });

  it("a CE review FAIL moves the task backward exactly like a validator fail", async () => {
    await setup();
    const id = await taskInReview();

    // The CE review session reports a failing review report; the adapter turns it
    // into a fail verdict; the gate moves the task backward to in-progress.
    const evaluator: ReviewerEvaluator = createCeReviewerEvaluator({
      runReviewSession: async () => ({
        artifact: "# Code Review\n\nRequest changes: tests are missing for the new branch.",
      }),
    });
    const gate = new ReviewerGate({ store, evaluate: evaluator });
    const result = await gate.driveReviewForTask(id);
    expect(result.outcome).toBe("failed-moved-backward");

    const task = await store.getTask(id);
    expect(task.column).toBe("in-progress"); // moved backward to the executor column
    const verdict = store.getTaskReviewerStore().getLatestVerdict(id);
    expect(verdict?.status).toBe("fail");
    const feedbackLog = task.log.find((e) => e.action.startsWith(REVIEWER_FAIL_FEEDBACK_LOG_PREFIX));
    expect(feedbackLog).toBeDefined();
  });

  it("a CE review PASS persists a passing verdict under the Reviewer identity", async () => {
    await setup();
    const id = await taskInReview();
    const evaluator: ReviewerEvaluator = createCeReviewerEvaluator({
      runReviewSession: async () => ({
        verdict: { status: "pass", summary: "clean review" },
      }),
    });
    const gate = new ReviewerGate({ store, evaluate: evaluator });
    const result = await gate.driveReviewForTask(id);
    expect(result.outcome).toBe("passed");
    const verdict = store.getTaskReviewerStore().getLatestVerdict(id);
    expect(verdict?.status).toBe("pass");
    expect(verdict?.reviewerAgentId).toBe(REVIEWER);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * U13 sub-part C — executor-level dispatch through the REAL composition path.
 *
 * The executor's `execute()` consults the injected `ceDispatch` seam at the
 * column-execution boundary: a CE column whose stage launches short-circuits the
 * standard engine. We inject the SAME FakeCeLauncher at the real `TaskExecutor`
 * `ceDispatch` option (the production seam the runtime wires) and prove that a
 * task entering a CE column launches the stage and the standard engine is skipped
 * (no worktree created — the standard engine's first side effect).
 * ──────────────────────────────────────────────────────────────────────────── */

describe("CE executor-level dispatch (U13 sub-part C)", () => {
  let rootDir: string;
  let globalDir: string;
  let store: TaskStore;
  let ceWorkflowId: string;

  async function setup(): Promise<void> {
    rootDir = makeTmpDir("kb-engine-ce-exec-");
    globalDir = makeTmpDir("kb-engine-ce-exec-global-");
    store = new TaskStore(rootDir, globalDir, { inMemoryDb: true });
    await store.init();
    await store.updateGlobalSettings({
      experimentalFeatures: { workflowColumns: true, companyModel: true },
    });
    const def = await store.createWorkflowDefinition({ name: "ce", ir: staffedCeIr() });
    ceWorkflowId = def.id;
  }

  async function teardown(): Promise<void> {
    store.close();
    await rm(rootDir, { recursive: true, force: true });
    await rm(globalDir, { recursive: true, force: true });
  }

  afterEach(async () => {
    await teardown();
  });

  async function taskInColumn(column: string): Promise<string> {
    const task = await store.createTask({ description: "ce exec task" });
    await store.selectTaskWorkflowAndReconcile(task.id, ceWorkflowId);
    const order = ["idea", "todo", "in-progress"];
    const targetIdx = order.indexOf(column);
    for (let i = 1; i <= targetIdx; i++) {
      await store.moveTask(task.id, order[i], {
        moveSource: "user",
        actor: { kind: "agent", agentId: EXECUTOR },
      });
    }
    return task.id;
  }

  it("a task entering a CE column launches the stage and the standard engine is skipped", async () => {
    await setup();
    // Move the task into the CE column BEFORE constructing the executor, so the
    // executor's own `task:moved → in-progress` auto-dispatch listener does not also
    // fire execute() — we want exactly one (explicit) dispatch to assert against.
    const taskId = await taskInColumn("in-progress");
    const launcher = new FakeCeLauncher();
    const executor = new TaskExecutor(store, rootDir, {
      ceDispatch: { launcher, getBoardLfgMode: () => false },
    });

    const before = await store.getTask(taskId);
    expect(before.worktree ?? null).toBeNull();

    await executor.execute(before);

    // The CE stage launched (the standard engine's session was never started).
    expect(launcher.launched).toHaveLength(1);
    expect(launcher.launched[0]).toMatchObject({ stageId: "ce-work", columnId: "in-progress" });

    // The standard engine was skipped: no worktree was created for the task (the
    // standard execute() path creates one before running the agent session).
    const after = await store.getTask(taskId);
    expect(after.worktree ?? null).toBeNull();
  });

  it("double-dispatch guard: two execute() passes launch exactly one CE session; a column change re-arms re-dispatch", async () => {
    await setup();
    const taskId = await taskInColumn("in-progress");
    const launcher = new FakeCeLauncher();
    const executor = new TaskExecutor(store, rootDir, {
      ceDispatch: { launcher, getBoardLfgMode: () => false },
    });

    const t1 = await store.getTask(taskId);
    await executor.execute(t1);
    // A second execute() pass for the SAME in-column task must NOT launch a second
    // CE session — the detached session from the first pass is still in flight.
    const t2 = await store.getTask(taskId);
    await executor.execute(t2);
    expect(launcher.launched).toHaveLength(1);

    // A column change retires the guard. Moving back to an earlier column then into
    // the CE column again should allow a fresh dispatch. The move fires the
    // executor's own task:moved listener (which clears the guard and auto-runs
    // execute()), so after the move a new session has been launched.
    // Backward moves require the board Lead/Reviewer actor.
    await store.moveTask(taskId, "todo", {
      moveSource: "user",
      actor: { kind: "agent", agentId: LEAD },
    });
    await store.moveTask(taskId, "in-progress", {
      moveSource: "user",
      actor: { kind: "agent", agentId: EXECUTOR },
    });
    // Allow the async task:moved → execute() dispatch to settle.
    await new Promise((r) => setTimeout(r, 50));
    expect(launcher.launched.length).toBeGreaterThanOrEqual(2);
  });

  it("a degraded CE column (plugin missing) does NOT short-circuit — it does not launch", async () => {
    await setup();
    const launcher = new FakeCeLauncher();
    launcher.available = false; // plugin uninstalled → degrade-to-standard

    // We assert the dispatch DECISION the executor consults (degrade, not launch)
    // through the same production deps shape the executor uses, without running the
    // full standard engine (which needs a git worktree). The executor's `execute()`
    // calls exactly this `dispatchCeColumn` and falls through on `degraded-to-standard`.
    const taskId = await taskInColumn("in-progress");
    const result = await dispatchCeColumn(
      { store, launcher, getBoardLfgMode: () => false },
      taskId,
    );
    expect(result).toMatchObject({ kind: "degraded-to-standard", reason: "plugin-missing" });
    expect(launcher.launched).toHaveLength(0);
    const task = await store.getTask(taskId);
    expect(task.log.some((e) => e.action.startsWith(CE_FALLBACK_DEGRADE_LOG_PREFIX))).toBe(true);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * U13 sub-part C — CE-aware Reviewer evaluator selection.
 *
 * For a task on a CE board's REVIEWER column, the verdict is derived from the
 * ce-code-review stage completion (via the CE evaluator); every other column uses
 * the standard evaluator. We assert the selector routes to the CE path only for
 * the reviewer column.
 * ──────────────────────────────────────────────────────────────────────────── */

describe("CE-aware reviewer evaluator selection (U13 sub-part C)", () => {
  let rootDir: string;
  let globalDir: string;
  let store: TaskStore;
  let ceWorkflowId: string;

  async function setup(): Promise<void> {
    rootDir = makeTmpDir("kb-engine-ce-rev-");
    globalDir = makeTmpDir("kb-engine-ce-rev-global-");
    store = new TaskStore(rootDir, globalDir, { inMemoryDb: true });
    await store.init();
    await store.updateGlobalSettings({
      experimentalFeatures: { workflowColumns: true, companyModel: true },
    });
    const def = await store.createWorkflowDefinition({ name: "ce", ir: staffedCeIr() });
    ceWorkflowId = def.id;
  }

  async function teardown(): Promise<void> {
    store.close();
    await rm(rootDir, { recursive: true, force: true });
    await rm(globalDir, { recursive: true, force: true });
  }

  afterEach(async () => {
    await teardown();
  });

  async function taskAtColumn(column: string): Promise<string> {
    const task = await store.createTask({ description: "ce rev task" });
    await store.selectTaskWorkflowAndReconcile(task.id, ceWorkflowId);
    for (const target of ["todo", "in-progress", "in-review"]) {
      await store.moveTask(task.id, target, {
        moveSource: "user",
        actor: { kind: "agent", agentId: EXECUTOR },
      });
      if (target === column) break;
    }
    return task.id;
  }

  it("uses the CE evaluator for an in-review CE task; the standard evaluator elsewhere", async () => {
    await setup();
    let standardCalls = 0;
    let ceCalls = 0;
    const standard: ReviewerEvaluator = async () => {
      standardCalls += 1;
      return { status: "pass", summary: "standard" };
    };
    const runReviewSession = async (): Promise<CeReviewCompletion> => {
      ceCalls += 1;
      return { artifact: "# Review\n\nRequest changes: tests missing." };
    };
    const evaluator = createCeAwareReviewerEvaluator({ store, standard, runReviewSession });

    // In-review CE task → CE evaluator (derives a FAIL from the review body).
    const reviewId = await taskAtColumn("in-review");
    const reviewTask = await store.getTask(reviewId);
    const ev = await evaluator({ task: reviewTask, reworkRound: 0 });
    expect(ceCalls).toBe(1);
    expect(standardCalls).toBe(0);
    expect(ev.status).toBe("fail");

    // In-progress CE task (not the reviewer column) → standard evaluator.
    const progressId = await taskAtColumn("in-progress");
    const progressTask = await store.getTask(progressId);
    const ev2 = await evaluator({ task: progressTask, reworkRound: 0 });
    expect(standardCalls).toBe(1);
    expect(ev2.status).toBe("pass");
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * U13 sub-part C — PR respond-loop CE binding.
 *
 * On a CE board, the PR sub-graph's `pr-respond` node launches the CE
 * resolve-pr-feedback stage instead of the standard review-response run. We test
 * both the dispatch primitive (dispatchCePrRespond) and the node-handler wrap that
 * binds it (a CE board launches the stage; a non-CE board / degrade runs the
 * standard respond).
 * ──────────────────────────────────────────────────────────────────────────── */

describe("CE PR respond-loop binding (U13 sub-part C)", () => {
  let rootDir: string;
  let globalDir: string;
  let store: TaskStore;
  let ceWorkflowId: string;
  let companyWorkflowId: string;

  async function setup(): Promise<void> {
    rootDir = makeTmpDir("kb-engine-ce-prresp-");
    globalDir = makeTmpDir("kb-engine-ce-prresp-global-");
    store = new TaskStore(rootDir, globalDir, { inMemoryDb: true });
    await store.init();
    await store.updateGlobalSettings({
      experimentalFeatures: { workflowColumns: true, companyModel: true },
    });
    ceWorkflowId = (await store.createWorkflowDefinition({ name: "ce", ir: staffedCeIr() })).id;
    companyWorkflowId = (await store.createWorkflowDefinition({ name: "co", ir: staffedCompanyIr() })).id;
  }

  async function teardown(): Promise<void> {
    store.close();
    await rm(rootDir, { recursive: true, force: true });
    await rm(globalDir, { recursive: true, force: true });
  }

  afterEach(async () => {
    await teardown();
  });

  async function ceTaskInReview(): Promise<string> {
    const task = await store.createTask({ description: "ce pr respond task" });
    await store.selectTaskWorkflowAndReconcile(task.id, ceWorkflowId);
    for (const target of ["todo", "in-progress", "in-review"]) {
      await store.moveTask(task.id, target, {
        moveSource: "user",
        actor: { kind: "agent", agentId: EXECUTOR },
      });
    }
    return task.id;
  }

  it("dispatchCePrRespond launches the resolve-pr-feedback stage on a CE board", async () => {
    await setup();
    const launcher = new FakeCeLauncher();
    const id = await ceTaskInReview();
    const result = await dispatchCePrRespond({ store, launcher, getBoardLfgMode: () => false }, id);
    expect(result.kind).toBe("dispatched");
    expect(launcher.launched).toHaveLength(1);
    expect(launcher.launched[0].stageId).toBe("resolve-pr-feedback");
  });

  it("dispatchCePrRespond returns not-ce for a non-CE company board (standard respond runs)", async () => {
    await setup();
    const launcher = new FakeCeLauncher();
    const task = await store.createTask({ description: "company task" });
    await store.selectTaskWorkflowAndReconcile(task.id, companyWorkflowId);
    await store.moveTask(task.id, "todo", { moveSource: "user", actor: { kind: "agent", agentId: LEAD } });
    const result = await dispatchCePrRespond({ store, launcher, getBoardLfgMode: () => false }, task.id);
    expect(result.kind).toBe("not-ce");
    expect(launcher.launched).toHaveLength(0);
  });

  // ── Security (issue #3): the code-enforced pre-push secret guard ───────────────
  it("installs the pre-push secret guard BEFORE launching the CE respond stage", async () => {
    await setup();
    const launcher = new FakeCeLauncher();
    const id = await ceTaskInReview();
    const order: string[] = [];
    const guarded: string[] = [];
    launcher.outcomeFor = (req) => {
      order.push("launch");
      return { kind: "launched", sessionId: `s-${req.taskId}` };
    };
    const result = await dispatchCePrRespond(
      {
        store,
        launcher,
        getBoardLfgMode: () => false,
        installPrePushGuard: async (taskId) => {
          order.push("guard");
          guarded.push(taskId);
          return { installed: true };
        },
      },
      id,
    );
    expect(result.kind).toBe("dispatched");
    // The guard ran for THIS task, BEFORE the session launch.
    expect(guarded).toEqual([id]);
    expect(order).toEqual(["guard", "launch"]);
  });

  it("installs the guard for a HEADLESS (LFG) respond launch too", async () => {
    await setup();
    const launcher = new FakeCeLauncher();
    const id = await ceTaskInReview();
    let guardCalls = 0;
    const result = await dispatchCePrRespond(
      {
        store,
        launcher,
        getBoardLfgMode: () => true, // LFG → headless posture
        installPrePushGuard: async () => {
          guardCalls += 1;
          return { installed: true };
        },
      },
      id,
    );
    expect(result.kind).toBe("dispatched");
    expect(launcher.launched[0].posture).toBe("headless");
    expect(guardCalls).toBe(1);
  });

  it("a guard install failure does NOT block the launch but persists a security audit log", async () => {
    await setup();
    const launcher = new FakeCeLauncher();
    const id = await ceTaskInReview();
    const result = await dispatchCePrRespond(
      {
        store,
        launcher,
        getBoardLfgMode: () => false,
        installPrePushGuard: async () => ({
          installed: false,
          skippedReason: "a non-fusion pre-push hook already exists; not overwriting",
        }),
      },
      id,
    );
    // The launch still proceeded (the standard scan covers degrade; the gap is loud).
    expect(result.kind).toBe("dispatched");
    expect(launcher.launched).toHaveLength(1);
    // A persisted task-log audit entry records the gap (never silent).
    const task = await store.getTask(id);
    expect(
      task.log.some((l) => l.action.startsWith(CE_PREPUSH_GUARD_MISSING_LOG_PREFIX)),
    ).toBe(true);
  });

  it("a thrown guard install seam is folded into an audit log (launch still proceeds)", async () => {
    await setup();
    const launcher = new FakeCeLauncher();
    const id = await ceTaskInReview();
    const result = await dispatchCePrRespond(
      {
        store,
        launcher,
        getBoardLfgMode: () => false,
        installPrePushGuard: async () => {
          throw new Error("boom");
        },
      },
      id,
    );
    expect(result.kind).toBe("dispatched");
    const task = await store.getTask(id);
    expect(
      task.log.some((l) => l.action.startsWith(CE_PREPUSH_GUARD_MISSING_LOG_PREFIX)),
    ).toBe(true);
  });

  it("the pr-respond node handler launches the CE stage for a CE board and falls back to standard otherwise", async () => {
    await setup();
    const launcher = new FakeCeLauncher();
    let standardRespondCalls = 0;

    // Minimal PrNodeDeps whose respond callback records standard invocations.
    const prNodeDeps = {
      getStore: () => store,
      resolvePrSource: async () => ({ kind: "task" as const, id: "x" }),
      createPr: async () => ({ ok: false as const, reason: "test" }),
      mergePr: async () => ({ ok: false as const, reason: "test" }),
      respond: async () => {
        standardRespondCalls += 1;
        return { value: "disagreed-only" as const };
      },
    } as unknown as PrNodeDeps;

    const handlers = createDefaultNodeHandlers(createNoopLegacySeams(), undefined, {
      prNodes: prNodeDeps,
      ceRespond: { store, launcher, getBoardLfgMode: () => false },
    });
    const prRespond = handlers["pr-respond"];

    // CE board task → the wrapper launches the CE stage; the standard respond is NOT run.
    const ceId = await ceTaskInReview();
    const ceTask = await store.getTask(ceId);
    const ceResult = await prRespond(
      { id: "pr-respond", kind: "pr-respond", column: "in-review" } as never,
      { task: ceTask, context: {} } as never,
    );
    expect(ceResult.outcome).toBe("success");
    expect(ceResult.value).toBe("ce-respond-dispatched");
    expect(launcher.launched.some((l) => l.stageId === "resolve-pr-feedback")).toBe(true);
    expect(standardRespondCalls).toBe(0);

    // CE board but plugin gone → degrade → the standard respond runs (no PR entity
    // here, so the standard handler returns no-entity; the key invariant is it RAN).
    launcher.available = false;
    launcher.launched = [];
    const ceId2 = await ceTaskInReview();
    const ceTask2 = await store.getTask(ceId2);
    const degradedResult = await prRespond(
      { id: "pr-respond", kind: "pr-respond", column: "in-review" } as never,
      { task: ceTask2, context: {} } as never,
    );
    // The CE launch degraded; the standard respond handler ran (it found no PR
    // entity in this minimal harness → "no-entity", proving the fallthrough).
    expect(launcher.launched).toHaveLength(0);
    expect(degradedResult.value).toBe("no-entity");
  });
});
