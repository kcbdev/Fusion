/**
 * CE column-engine dispatch (company-model U13 sub-part B).
 *
 * Sub-part A (`packages/core/src/ce-board-template.ts`) defined the CE board
 * template, the `engine: { kind: "ce-stage", stageId }` carrier on each working
 * column, the `isCeBoardIr` predicate, the per-column stage read accessor
 * (`resolveCeStageForColumn`), and the per-task LFG override helpers. This module
 * is the ENGINE-SIDE DISPATCH SEAM that consumes those: when a task enters a
 * column whose IR carries a `ce-stage` engine binding, the engine runs the bound
 * CE stage as a CE Session (through the plugin's orchestrator) INSTEAD of the
 * standard engine.
 *
 * ## Why a DI seam (not a direct plugin import)
 *
 * The engine package must not import the compound-engineering plugin (layering:
 * plugins depend on `@fusion/core` + `@fusion/engine`, never the reverse). The CE
 * Session machinery (the orchestrator's `start`/`answer`/`resume` over the
 * interactive AI session, and its artifact writing) lives in the plugin. So this
 * module takes the plugin orchestrator behind a narrow injected interface
 * ({@link CeSessionLauncher}): the runtime wires the real plugin launcher; tests
 * inject a deterministic fake. The dispatch/adapter/fallback/LFG/parking LOGIC —
 * the net-new U13 work — lives here and is fully unit-testable around the faked
 * session layer.
 *
 * ## What this module owns
 *
 * 1. **Dispatch binding** ({@link dispatchCeColumn}): resolve the stage bound to
 *    the task's current column, resolve the effective posture (LFG → headless),
 *    and launch the CE session. Plugin/stage missing at dispatch → degrade to the
 *    standard engine with a persisted audit event (never silent).
 * 2. **Structured-outcome adapter** ({@link adaptCeReviewOutcome},
 *    {@link createCeReviewerEvaluator}): a ce-code-review stage completes with a
 *    markdown artifact, not a verdict. The adapter parses/derives a pass/fail +
 *    findings outcome and feeds it to the U6 verdict interface (the
 *    `ReviewerGate`'s `evaluate` seam), so a CE review failure moves the task
 *    backward exactly like a validator fail.
 * 3. **Parked-state release** ({@link resolveCeParkedReleasePosture}): a task in
 *    a plan-approval hold or awaiting-input whose CE engine is GONE at release
 *    parks with a plugin-missing needs-attention diagnostic — it does NOT degrade
 *    into an engine that can't consume the artifact.
 * 4. **LFG threading** (R22): the effective posture (interactive vs headless) is
 *    a SESSION attribute carried in the launch request — never an agent
 *    attribute — so one CE column agent can run a parked interactive task and a
 *    headless LFG task concurrently. LFG suppresses the interactive question
 *    opening, never persists awaiting-input, and skips the plan-approval hold. A
 *    stage with NO safe headless default parks the task with a needs-attention
 *    diagnostic (LFG demoted for that task) rather than fabricating an answer.
 */

import type { TaskStore, WorkflowIr } from "@fusion/core";
import {
  isCeBoardIr,
  resolveCeStageForColumn,
  resolveEffectiveLfgMode,
  resolveWorkflowIrForTask,
  withTaskLfgOverride,
  CE_RESPOND_LOOP_STAGE_ID,
} from "@fusion/core";
import { createLogger } from "./logger.js";
import { createRunAuditor, generateSyntheticRunId, type EngineRunContext } from "./run-audit.js";
import type { Task } from "@fusion/core";
import { resolveCompanyRoleColumnId } from "@fusion/core";
import type { ReviewerEvaluation, ReviewerEvaluator } from "./reviewer-gate.js";

const ceLog = createLogger("ce-dispatch");

/* ────────────────────────────────────────────────────────────────────────────
 * Stable task-log action prefixes (board surfaces these as diagnostics/audits).
 * ──────────────────────────────────────────────────────────────────────────── */

/** Persisted needs-attention diagnostic: a CE column's plugin/stage was gone at
 *  the release of a PARKED task (approval hold / awaiting-input). The task is NOT
 *  degraded — the artifact-consuming engine is unavailable — so it parks for a
 *  human. The board surfaces this as a distinct stuck-style badge. */
export const CE_PLUGIN_MISSING_PARK_LOG_PREFIX =
  "CE engine needs attention [plugin-missing]:";

/** Persisted needs-attention diagnostic: an LFG task hit a CE stage with no safe
 *  headless default. The task is DEMOTED out of LFG and parks for a human input
 *  rather than fabricating an answer. */
export const CE_LFG_NO_SAFE_DEFAULT_PARK_LOG_PREFIX =
  "CE engine needs attention [lfg-no-safe-default]:";

/** Persisted audit note: a CE column degraded to the standard engine because its
 *  plugin/stage was missing at dispatch (a non-parked task — degrade, not park). */
export const CE_FALLBACK_DEGRADE_LOG_PREFIX = "CE engine fallback [degrade-to-standard]:";

/** Persisted security audit: the code-enforced pre-push secret guard could not be
 *  installed into a CE PR-respond worktree (the session would push WITHOUT the
 *  git-side credential scan). The launch still proceeds, but the gap is logged
 *  loudly so it is never silent. */
export const CE_PREPUSH_GUARD_MISSING_LOG_PREFIX =
  "CE security needs attention [prepush-guard-not-installed]:";

/* ────────────────────────────────────────────────────────────────────────────
 * Posture (R22): a SESSION attribute, not an agent attribute.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * The execution posture for a single CE session. Posture is keyed PER SESSION so
 * one CE column agent can run a parked interactive task and a headless LFG task
 * concurrently — neither posture's lifecycle disturbs the other.
 *
 * - `interactive`: the default. The stage may open blocking questions
 *   (`awaiting-input`); the plan-approval hold (R20) applies.
 * - `headless`: LFG mode (R22). The stage runs in its pipeline/headless form: no
 *   blocking questions, autonomous defaults, never persists awaiting-input, and
 *   the plan-approval hold is skipped.
 */
export type CeSessionPosture = "interactive" | "headless";

/* ────────────────────────────────────────────────────────────────────────────
 * The injected CE-session seam (the plugin orchestrator, faked in tests).
 * ──────────────────────────────────────────────────────────────────────────── */

/** A request to launch a CE stage as a session for a task entering a column. */
export interface CeSessionLaunchRequest {
  taskId: string;
  /** The CE stage id bound to the column (from `resolveCeStageForColumn`). */
  stageId: string;
  /** The column the task entered (drives the seam: plan/work/review/compound). */
  columnId: string;
  /** The effective posture for THIS session (R22). Carried per-session. */
  posture: CeSessionPosture;
  /** The column agent's id (the effective Lead/Executor/Reviewer/Compound agent). */
  columnAgentId?: string;
  /** Opening message / topic for the stage (e.g. the task description / PROMPT). */
  openingMessage: string;
}

/** The terminal disposition a launched CE session reports back. */
export type CeSessionLaunchOutcome =
  /** The session ran (possibly still in flight in detached mode); the engine
   *  proceeds with the normal transition machinery on stage completion. */
  | { kind: "launched"; sessionId: string }
  /** The launcher could not run because the bound stage is unknown to the plugin
   *  registry (e.g. stage id not registered). Triggers fallback/parking. */
  | { kind: "stage-unavailable"; stageId: string }
  /** A headless launch was requested for a stage that has NO safe headless
   *  default (it would have to ask a blocking question). The task is demoted out
   *  of LFG and parked — never an fabricated answer. */
  | { kind: "no-safe-headless-default"; stageId: string };

/**
 * The narrow seam onto the plugin's CE-session machinery. The runtime wires the
 * real launcher (which calls `CeOrchestrator.start(stageId, { detach: true })`
 * with posture-derived options); tests inject a deterministic fake.
 *
 * `isAvailable()` is the plugin-installed probe: false when the
 * compound-engineering plugin is not installed (the whole CE backend is gone),
 * which is distinct from a single stage being unregistered (`stage-unavailable`).
 */
export interface CeSessionLauncher {
  /** True when the CE plugin is installed and its session backend is reachable. */
  isAvailable(): boolean;
  /** Whether the plugin registers the given stage id (the bundled-stage probe). */
  hasStage(stageId: string): boolean;
  /** Launch the stage as a CE session. */
  launch(req: CeSessionLaunchRequest): Promise<CeSessionLaunchOutcome>;
  /**
   * Run the ce-code-review stage to COMPLETION for a task and return its
   * structured completion (the review report markdown + optional verdict). Used by
   * the U13 CE-aware Reviewer evaluator ({@link createCeAwareReviewerEvaluator})
   * to feed the U6 verdict interface. Optional — when unset, the CE-aware
   * evaluator falls back to the standard AI-judge evaluator for CE in-review
   * columns (no CE review specialization, but never a stall).
   */
  runReviewSession?: (taskId: string, reworkRound: number) => Promise<CeReviewCompletion>;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Dispatch.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface CeDispatchDeps {
  store: TaskStore;
  /** The injected CE-session seam (real plugin launcher / test fake). */
  launcher: CeSessionLauncher;
  /** Resolve the workflow IR a task runs under. Defaults to the core resolver;
   *  injectable for tests. */
  resolveIr?: (taskId: string) => Promise<WorkflowIr>;
  /** Resolve the board's LFG default for a task. Defaults to reading the task's
   *  board via the BoardStore; injectable for tests. */
  getBoardLfgMode?: (taskId: string) => boolean;
  /** Resolve the column agent id for a column on a CE board (effective identity
   *  governing the session). Optional — only used to attribute the session. */
  resolveColumnAgentId?: (ir: WorkflowIr, columnId: string) => string | undefined;
  /**
   * Security (issue #3): install the code-enforced pre-push secret guard into the
   * task's worktree BEFORE launching the CE PR-respond stage. The CE session is an
   * untrusted interactive/headless AI with its own shell that can `git push`
   * itself, so the standard path's engine-owned `scanSecrets` does not cover it.
   * The guard is a git pre-push hook (see {@link ./ce-prepush-guard.ts}) git
   * enforces at push time — interactive AND headless. Returns whether the guard is
   * in place; an install failure does NOT block the launch but is logged loudly
   * (the gap is never silent). Injected by the runtime; faked in tests.
   */
  installPrePushGuard?: (taskId: string) => Promise<CePrePushGuardInstall>;
}

/** Outcome of installing the pre-push secret guard for a CE PR-respond launch. */
export interface CePrePushGuardInstall {
  installed: boolean;
  /** Non-fatal reason the guard could not be installed (logged, never thrown). */
  skippedReason?: string;
}

/** What `dispatchCeColumn` did, for the engine caller + tests/observability. */
export type CeDispatchResult =
  /** Not a CE column (no `ce-stage` binding on the task's current column) — the
   *  caller runs the STANDARD engine. */
  | { kind: "not-ce-column" }
  /** The CE stage launched as a session; the caller does NOT run the standard
   *  engine (the CE session drives the column; completion advances it). */
  | { kind: "dispatched"; sessionId: string; stageId: string; posture: CeSessionPosture }
  /** The plugin/stage was missing at dispatch → degraded to the standard engine
   *  with a persisted audit event. The caller runs the STANDARD engine. */
  | { kind: "degraded-to-standard"; stageId: string; reason: "plugin-missing" | "stage-unavailable" }
  /** An LFG task hit a stage with no safe headless default → parked with a
   *  needs-attention diagnostic (LFG demoted). The caller runs NOTHING. */
  | { kind: "parked-lfg-no-safe-default"; stageId: string };

/**
 * Dispatch the column a task just entered.
 *
 * Decision order:
 *  1. Not a CE board / no `ce-stage` binding on the current column → caller runs
 *     the standard engine (`not-ce-column`).
 *  2. Plugin not installed OR the bound stage unregistered → DEGRADE to the
 *     standard engine + persist an audit event (`degraded-to-standard`). Never a
 *     silent stall. (Parked-state release is the separate
 *     {@link resolveCeParkedReleasePosture} path — a task entering a column fresh
 *     can always run the standard engine.)
 *  3. Resolve effective posture (LFG → headless) PER SESSION and launch. A
 *     headless launch a stage cannot satisfy parks the task (LFG demoted),
 *     `parked-lfg-no-safe-default`. Otherwise `dispatched`.
 */
export async function dispatchCeColumn(
  deps: CeDispatchDeps,
  taskId: string,
): Promise<CeDispatchResult> {
  const resolveIr = deps.resolveIr ?? ((id) => defaultResolveIr(deps.store, id));
  const ir = await resolveIr(taskId);
  if (!isCeBoardIr(ir)) {
    return { kind: "not-ce-column" };
  }

  const task = await deps.store.getTask(taskId);
  const columnId = task.column;
  const stageId = resolveCeStageForColumn(ir, columnId);
  if (!stageId) {
    // A CE board column with no stage binding (idea/done/archived) runs the
    // standard engine — these are intake/terminal columns, never CE-driven.
    return { kind: "not-ce-column" };
  }

  // Fallback (degrade): plugin gone, or the bound stage is not registered. A task
  // ENTERING a column can always fall back to the standard engine; only PARKED
  // states (approval hold / awaiting-input) must park instead of degrade — that
  // is the separate resolveCeParkedReleasePosture path.
  if (!deps.launcher.isAvailable()) {
    await recordDegrade(deps.store, taskId, stageId, "plugin-missing");
    return { kind: "degraded-to-standard", stageId, reason: "plugin-missing" };
  }
  if (!deps.launcher.hasStage(stageId)) {
    await recordDegrade(deps.store, taskId, stageId, "stage-unavailable");
    return { kind: "degraded-to-standard", stageId, reason: "stage-unavailable" };
  }

  // Effective posture (R22): board default + per-task override → headless when
  // LFG, interactive otherwise. Posture is a SESSION attribute, carried in the
  // launch request — one column agent can run both postures concurrently.
  const boardLfgMode = deps.getBoardLfgMode
    ? deps.getBoardLfgMode(taskId)
    : defaultBoardLfgMode(deps.store, taskId);
  const lfg = resolveEffectiveLfgMode(task, boardLfgMode);
  const posture: CeSessionPosture = lfg ? "headless" : "interactive";

  const columnAgentId =
    deps.resolveColumnAgentId?.(ir, columnId) ?? undefined;

  const outcome = await deps.launcher.launch({
    taskId,
    stageId,
    columnId,
    posture,
    columnAgentId,
    openingMessage: buildOpeningMessage(task),
  });

  switch (outcome.kind) {
    case "launched":
      return { kind: "dispatched", sessionId: outcome.sessionId, stageId, posture };
    case "stage-unavailable":
      // A stage that disappeared between the probe and the launch — degrade.
      await recordDegrade(deps.store, taskId, stageId, "stage-unavailable");
      return { kind: "degraded-to-standard", stageId, reason: "stage-unavailable" };
    case "no-safe-headless-default":
      // R22 backstop: never fabricate an answer. Demote out of LFG and park.
      await recordLfgNoSafeDefaultPark(deps.store, taskId, stageId);
      return { kind: "parked-lfg-no-safe-default", stageId };
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * PR respond-loop dispatch (U13 sub-part C / U7 PR sub-graph binding).
 * ──────────────────────────────────────────────────────────────────────────── */

/** What `dispatchCePrRespond` did, for the pr-respond node wrapper. */
export type CePrRespondResult =
  /** Not a CE board → the caller runs the STANDARD pr-respond behavior. */
  | { kind: "not-ce" }
  /** The CE resolve-pr-feedback stage launched as a session → the caller does NOT
   *  run the standard respond (the CE session drives the resolution). */
  | { kind: "dispatched"; sessionId: string; posture: CeSessionPosture }
  /** Plugin/stage missing or LFG cannot proceed → DEGRADE to the standard respond
   *  with a persisted audit event (same degrade+audit fallback as column dispatch). */
  | { kind: "degraded-to-standard"; reason: "plugin-missing" | "stage-unavailable" | "no-safe-headless-default" };

/**
 * Bind the PR sub-graph's `pr-respond` step to the CE resolve-pr-feedback stage
 * for a CE board (U13). When the task is on a CE board, the respond step launches
 * the {@link CE_RESPOND_LOOP_STAGE_ID} stage as a posture-aware CE Session
 * (interactive or LFG-headless) INSTEAD of the standard review-response run. A
 * plugin/stage-missing or no-safe-headless-default outcome DEGRADES to the
 * standard respond with a persisted audit event — the same degrade+audit fallback
 * the column dispatch uses. A non-CE board returns `not-ce` so the caller runs the
 * standard respond unchanged (kill-switch parity).
 */
export async function dispatchCePrRespond(
  deps: CeDispatchDeps,
  taskId: string,
): Promise<CePrRespondResult> {
  const resolveIr = deps.resolveIr ?? ((id) => defaultResolveIr(deps.store, id));
  const ir = await resolveIr(taskId);
  if (!isCeBoardIr(ir)) return { kind: "not-ce" };

  const stageId = CE_RESPOND_LOOP_STAGE_ID;
  if (!deps.launcher.isAvailable()) {
    await recordDegrade(deps.store, taskId, stageId, "plugin-missing");
    return { kind: "degraded-to-standard", reason: "plugin-missing" };
  }
  if (!deps.launcher.hasStage(stageId)) {
    await recordDegrade(deps.store, taskId, stageId, "stage-unavailable");
    return { kind: "degraded-to-standard", reason: "stage-unavailable" };
  }

  const task = await deps.store.getTask(taskId);
  const boardLfgMode = deps.getBoardLfgMode
    ? deps.getBoardLfgMode(taskId)
    : defaultBoardLfgMode(deps.store, taskId);
  const lfg = resolveEffectiveLfgMode(task, boardLfgMode);
  const posture: CeSessionPosture = lfg ? "headless" : "interactive";

  // Security (issue #3): install the code-enforced pre-push secret guard BEFORE the
  // session can run. The CE session is untrusted (its shell can `git push` directly)
  // so the scan must be a git-enforced pre-push hook in the worktree, active for
  // interactive AND headless/LFG sessions. An install failure does not block the
  // launch (the session still runs) but is persisted loudly — the gap is never
  // silent. The standard respond path keeps its own engine-owned scanSecrets on the
  // degrade branches below.
  if (deps.installPrePushGuard) {
    await installPrePushGuardForRespond(deps, taskId);
  }

  const outcome = await deps.launcher.launch({
    taskId,
    stageId,
    columnId: task.column,
    posture,
    columnAgentId: deps.resolveColumnAgentId?.(ir, task.column) ?? undefined,
    openingMessage: buildOpeningMessage(task),
  });

  switch (outcome.kind) {
    case "launched":
      return { kind: "dispatched", sessionId: outcome.sessionId, posture };
    case "stage-unavailable":
      await recordDegrade(deps.store, taskId, stageId, "stage-unavailable");
      return { kind: "degraded-to-standard", reason: "stage-unavailable" };
    case "no-safe-headless-default":
      await recordDegrade(deps.store, taskId, stageId, "no-safe-headless-default");
      return { kind: "degraded-to-standard", reason: "no-safe-headless-default" };
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Parked-state release (plugin uninstalled while a CE task is parked).
 * ──────────────────────────────────────────────────────────────────────────── */

/** What to do when releasing a parked CE task (approval hold / awaiting-input). */
export type CeParkedReleaseDecision =
  /** Release normally — the CE engine is present; re-dispatch the column. */
  | { kind: "release"; stageId: string }
  /** Park with a plugin-missing diagnostic — the CE engine is gone and the
   *  standard engine cannot consume the CE artifact, so do NOT degrade. */
  | { kind: "park-plugin-missing"; stageId: string }
  /** Not a CE-engine column — the caller's normal (non-CE) release path applies. */
  | { kind: "not-ce-column" };

/**
 * Decide how to release a task that was PARKED on a CE column (in a plan-approval
 * hold or awaiting-input). Unlike a fresh column entry (which degrades to the
 * standard engine when the plugin is gone), a parked CE task whose engine has
 * disappeared parks with a plugin-missing needs-attention diagnostic: the work in
 * flight (a plan artifact, a pending question) is bound to the CE engine, and the
 * standard engine cannot consume it. Degrading here would silently drop the
 * artifact — the plan forbids it.
 */
export async function resolveCeParkedReleasePosture(
  deps: Pick<CeDispatchDeps, "store" | "launcher" | "resolveIr">,
  taskId: string,
): Promise<CeParkedReleaseDecision> {
  const resolveIr = deps.resolveIr ?? ((id) => defaultResolveIr(deps.store, id));
  const ir = await resolveIr(taskId);
  if (!isCeBoardIr(ir)) return { kind: "not-ce-column" };

  const task = await deps.store.getTask(taskId);
  const stageId = resolveCeStageForColumn(ir, task.column);
  if (!stageId) return { kind: "not-ce-column" };

  // Engine present (plugin installed AND the bound stage registered) → release.
  if (deps.launcher.isAvailable() && deps.launcher.hasStage(stageId)) {
    return { kind: "release", stageId };
  }

  // Engine gone at release of a parked task → park with a plugin-missing
  // diagnostic. Do NOT degrade (the standard engine can't consume the artifact).
  await recordPluginMissingPark(deps.store, taskId, stageId);
  return { kind: "park-plugin-missing", stageId };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Structured-outcome adapter (ce-code-review completion → U6 verdict).
 * ──────────────────────────────────────────────────────────────────────────── */

/** The shape a completed ce-code-review session reports to the adapter. The
 *  plugin's review skill emits its findings as a structured tail in the artifact;
 *  the adapter is tolerant of both a structured payload and a raw markdown body
 *  (deriving pass/fail from the body when no structured verdict is present). */
export interface CeReviewCompletion {
  /** The review report markdown (the stage artifact body). */
  artifact?: string;
  /** Optional structured verdict the skill emitted alongside the artifact. When
   *  present it is authoritative; otherwise the adapter derives from `artifact`. */
  verdict?: {
    status?: unknown;
    summary?: unknown;
    findings?: unknown;
  };
}

/**
 * Adapt a ce-code-review stage completion into a {@link ReviewerEvaluation} for
 * the U6 verdict interface. Precedence:
 *  1. An explicit structured `verdict.status` of pass/fail/blocked is
 *     authoritative; its `findings` map onto failure reasons.
 *  2. Otherwise derive from the markdown body: a body that contains blocking
 *     review findings (a non-empty findings/issues section, or an explicit
 *     "REQUEST CHANGES" / "FAIL" marker) is a FAIL; a clean review ("LGTM" /
 *     "APPROVE" / no blocking findings) is a PASS.
 *  3. A completion with neither a verdict nor any artifact body is an ERROR (the
 *     review produced no judgment — never silently pass).
 *
 * A FAIL maps to the same backward-move path a validator fail takes (the
 * ReviewerGate's fail flow), because this evaluator is wired as the gate's
 * `evaluate` seam (see {@link createCeReviewerEvaluator}).
 */
export function adaptCeReviewOutcome(completion: CeReviewCompletion): ReviewerEvaluation {
  // 1. Authoritative structured verdict.
  const v = completion.verdict;
  if (v && typeof v.status === "string") {
    const status = v.status.toLowerCase();
    if (status === "pass" || status === "fail" || status === "blocked") {
      const summary =
        typeof v.summary === "string" && v.summary.trim()
          ? v.summary
          : `CE code review: ${status}`;
      const failureReasons =
        status === "fail" ? extractStructuredFindings(v.findings) : undefined;
      return { status, summary, failureReasons };
    }
  }

  // 2. Derive from the markdown body.
  const body = (completion.artifact ?? "").trim();
  if (!body) {
    return {
      status: "error",
      summary: "CE code review produced no verdict and no artifact",
    };
  }
  const derived = deriveVerdictFromReviewBody(body);
  return derived;
}

/**
 * Wrap the CE-session review layer as a {@link ReviewerEvaluator} so the U6
 * `ReviewerGate` drives a CE review exactly like a validator: on FAIL the gate's
 * existing flow attaches feedback and moves the task backward (or parks on budget
 * exhaustion). `runReviewSession` is the injected seam that runs the
 * ce-code-review stage to completion and returns its structured completion; the
 * runtime wires it to the plugin orchestrator, tests inject a fake.
 */
export function createCeReviewerEvaluator(deps: {
  runReviewSession: (taskId: string, reworkRound: number) => Promise<CeReviewCompletion>;
}): ReviewerEvaluator {
  return async ({ task, reworkRound }) => {
    if (!task) {
      return { status: "error", summary: "CE review: task not found" };
    }
    try {
      const completion = await deps.runReviewSession(task.id, reworkRound);
      return adaptCeReviewOutcome(completion);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ceLog.error(`CE review session failed for task ${task.id}: ${message}`);
      return { status: "error", summary: `CE review session error: ${message}` };
    }
  };
}

/**
 * Compose a {@link ReviewerEvaluator} that selects the CE code-review evaluator
 * for a task sitting on a CE board's REVIEWER column, and falls back to the
 * standard (AI-judge) evaluator everywhere else. This is the U6 verdict-interface
 * wiring point for U13: the ReviewerGate fires the same way on in-review entry,
 * but for a CE in-review column the verdict is derived from the ce-code-review
 * stage completion (via {@link createCeReviewerEvaluator}) instead of the generic
 * judge. A resolution failure (no IR / store error) degrades to the standard
 * evaluator — kill-switch parity, never a stall.
 *
 * `runReviewSession` is the injected seam that runs the ce-code-review stage to
 * completion and returns its structured completion (wired by the runtime to the
 * plugin orchestrator; faked in tests).
 */
export function createCeAwareReviewerEvaluator(deps: {
  store: Pick<TaskStore, "getTask">;
  standard: ReviewerEvaluator;
  runReviewSession: (taskId: string, reworkRound: number) => Promise<CeReviewCompletion>;
  resolveIr?: (taskId: string) => Promise<WorkflowIr>;
}): ReviewerEvaluator {
  const ceEvaluator = createCeReviewerEvaluator({ runReviewSession: deps.runReviewSession });
  const resolveIr =
    deps.resolveIr ??
    ((id: string) => defaultResolveIr(deps.store as unknown as TaskStore, id));
  return async (input) => {
    const task = input.task as Task | undefined;
    if (!task) return deps.standard(input);
    try {
      const ir = await resolveIr(task.id);
      if (isCeBoardIr(ir)) {
        const reviewerColumnId = resolveCompanyRoleColumnId(ir, "reviewer");
        if (reviewerColumnId && task.column === reviewerColumnId) {
          return ceEvaluator(input);
        }
      }
    } catch (err) {
      ceLog.warn(
        `CE-aware reviewer selection failed for ${task.id}; using standard evaluator: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return deps.standard(input);
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Internals.
 * ──────────────────────────────────────────────────────────────────────────── */

function extractStructuredFindings(raw: unknown): ReviewerEvaluation["failureReasons"] {
  if (!Array.isArray(raw)) return undefined;
  const reasons = raw
    .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
    .map((r) => ({
      title: typeof r.title === "string" ? r.title : "Finding",
      message: typeof r.message === "string" ? r.message : "",
      expected: typeof r.expected === "string" ? r.expected : undefined,
      actual: typeof r.actual === "string" ? r.actual : undefined,
    }));
  return reasons.length > 0 ? reasons : undefined;
}

/** Derive a pass/fail verdict from a ce-code-review markdown body. Blocking
 *  markers / a non-empty findings section → fail; clean review → pass. */
function deriveVerdictFromReviewBody(body: string): ReviewerEvaluation {
  const lower = body.toLowerCase();
  // Explicit blocking markers win.
  const blocking =
    /\brequest\s+changes\b/.test(lower) ||
    /\bchanges\s+requested\b/.test(lower) ||
    /^\s*(verdict|status)\s*[:=]\s*fail/m.test(lower) ||
    // Phrase-level blocking signals only. The bare word /\bblocking\b/ was too
    // broad: a neutral sentence like "avoids blocking the event loop" classified
    // a clean review as fail. Require "blocking" to qualify an issue/finding noun.
    /\bblocking\s+(issue|issues|finding|findings|problem|problems|concern|concerns|bug|bugs|comment|comments)\b/.test(
      lower,
    );
  const clean =
    /\blgtm\b/.test(lower) ||
    /\bapprove(d)?\b/.test(lower) ||
    /^\s*(verdict|status)\s*[:=]\s*pass/m.test(lower) ||
    /\bno\s+(blocking\s+)?(issues|findings)\b/.test(lower);

  if (blocking && !clean) {
    return {
      status: "fail",
      summary: firstLine(body) || "CE code review requested changes",
      failureReasons: [
        {
          title: "Code review findings",
          message: truncate(body, 1200),
        },
      ],
    };
  }
  if (clean) {
    return { status: "pass", summary: firstLine(body) || "CE code review passed" };
  }
  // Ambiguous body with neither a clean nor a blocking marker: treat the presence
  // of a findings/issues heading with content as a fail; otherwise pass. This is
  // the conservative default — a review that enumerated issues should not pass.
  const findingsHeading = /^#{1,6}\s*(findings|issues|problems)\b/im.test(body);
  if (findingsHeading) {
    return {
      status: "fail",
      summary: firstLine(body) || "CE code review reported findings",
      failureReasons: [{ title: "Code review findings", message: truncate(body, 1200) }],
    };
  }
  return { status: "pass", summary: firstLine(body) || "CE code review passed" };
}

function firstLine(s: string): string {
  const line = s.split("\n").map((l) => l.replace(/^#+\s*/, "").trim()).find((l) => l.length > 0);
  return line ? truncate(line, 200) : "";
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** The opening message handed to the stage session: the structured PROMPT.md
 *  content when present, else the task description, else the title. */
function buildOpeningMessage(task: {
  prompt?: string;
  description?: string;
  title?: string;
  id: string;
}): string {
  return task.prompt?.trim() || task.description?.trim() || task.title?.trim() || task.id;
}

function defaultResolveIr(store: TaskStore, taskId: string): Promise<WorkflowIr> {
  return resolveWorkflowIrForTask(store, taskId);
}

function defaultBoardLfgMode(store: TaskStore, taskId: string): boolean {
  try {
    const boardId = store.getTaskBoardId(taskId);
    if (!boardId) return false;
    const board = store.getBoardStore().getBoard(boardId);
    return board?.lfgMode ?? false;
  } catch {
    return false;
  }
}

function ceRunContext(taskId: string): EngineRunContext {
  return {
    runId: generateSyntheticRunId("ce-dispatch", taskId),
    agentId: "ce-dispatch",
    taskId,
    phase: "ce-dispatch",
    source: "column-entry",
  };
}

/**
 * Install the pre-push secret guard for a CE PR-respond launch (issue #3). Never
 * throws: a thrown install seam or a `installed: false` result is folded into a
 * persisted security-audit log entry (the gap is loud, not silent) and the launch
 * proceeds. A successful install is intentionally not logged (no noise).
 */
async function installPrePushGuardForRespond(
  deps: CeDispatchDeps,
  taskId: string,
): Promise<void> {
  let result: CePrePushGuardInstall;
  try {
    result = await deps.installPrePushGuard!(taskId);
  } catch (err) {
    result = {
      installed: false,
      skippedReason: `guard install threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (result.installed) return;
  const reason = result.skippedReason ?? "unknown reason";
  await deps.store
    .logEntry(
      taskId,
      `${CE_PREPUSH_GUARD_MISSING_LOG_PREFIX} ${reason}`,
      `The code-enforced pre-push secret scan could not be installed into this ` +
        `task's worktree before launching the CE resolve-pr-feedback session. The ` +
        `session may push without the git-side credential scan. Verify the worktree ` +
        `is a git repository and that no conflicting pre-push hook is present.`,
    )
    .catch((err) => {
      ceLog.warn(
        `failed to log CE prepush-guard gap for ${taskId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  const auditor = createRunAuditor(deps.store, ceRunContext(taskId));
  await auditor
    .database({
      type: "task:update",
      target: taskId,
      metadata: { ceSecurity: "prepush-guard-not-installed", reason },
    })
    .catch((err) => {
      ceLog.warn(
        `failed to audit CE prepush-guard gap for ${taskId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
}

async function recordDegrade(
  store: TaskStore,
  taskId: string,
  stageId: string,
  reason: "plugin-missing" | "stage-unavailable" | "no-safe-headless-default",
): Promise<void> {
  const note =
    reason === "plugin-missing"
      ? `the compound-engineering plugin is not installed; running the standard engine for stage "${stageId}"`
      : reason === "no-safe-headless-default"
        ? `CE stage "${stageId}" has no safe headless default; running the standard engine`
        : `CE stage "${stageId}" is not registered; running the standard engine`;
  await store.logEntry(taskId, `${CE_FALLBACK_DEGRADE_LOG_PREFIX} ${note}`).catch((err) => {
    ceLog.warn(`failed to log CE degrade for ${taskId}: ${err instanceof Error ? err.message : String(err)}`);
  });
  // Persisted audit event (never a silent degrade).
  const auditor = createRunAuditor(store, ceRunContext(taskId));
  await auditor
    .database({
      type: "task:update",
      target: taskId,
      metadata: { ceEngineFallback: "degrade-to-standard", stageId, reason },
    })
    .catch((err) => {
      ceLog.warn(`failed to audit CE degrade for ${taskId}: ${err instanceof Error ? err.message : String(err)}`);
    });
}

async function recordPluginMissingPark(
  store: TaskStore,
  taskId: string,
  stageId: string,
): Promise<void> {
  await store
    .logEntry(
      taskId,
      `${CE_PLUGIN_MISSING_PARK_LOG_PREFIX} stage "${stageId}"`,
      `The compound-engineering plugin/stage for this column is no longer available. ` +
        `This task was parked (plan-approval hold or awaiting-input) and its in-flight CE ` +
        `artifact cannot be consumed by the standard engine, so it is parked for human ` +
        `attention rather than degraded.`,
    )
    .catch((err) => {
      ceLog.warn(`failed to log CE plugin-missing park for ${taskId}: ${err instanceof Error ? err.message : String(err)}`);
    });
}

async function recordLfgNoSafeDefaultPark(
  store: TaskStore,
  taskId: string,
  stageId: string,
): Promise<void> {
  await store
    .logEntry(
      taskId,
      `${CE_LFG_NO_SAFE_DEFAULT_PARK_LOG_PREFIX} stage "${stageId}"`,
      `This LFG-mode task reached CE stage "${stageId}", which has no safe headless ` +
        `default — it would need to ask a blocking question. Rather than fabricate an ` +
        `answer, the task is demoted out of LFG and parked for human input.`,
    )
    .catch((err) => {
      ceLog.warn(`failed to log CE LFG no-safe-default park for ${taskId}: ${err instanceof Error ? err.message : String(err)}`);
    });

  // The log alone does not change task state, so the executor would re-dispatch
  // the column on the next tick → an infinite re-dispatch loop. Actually park the
  // task: a non-stuck awaiting-input status (exempt from stuck detection via
  // AWAITING_INPUT_NON_STUCK_STATUSES) + paused (suppresses task:updated
  // re-dispatch), and clear the per-task LFG override so it demotes to interactive
  // when a human un-parks it.
  try {
    const task = await store.getTask(taskId);
    await store.updateTask(taskId, {
      status: "awaiting-user-input",
      paused: true,
      customFields: withTaskLfgOverride(task.customFields, false),
    });
  } catch (err) {
    ceLog.warn(
      `failed to persist CE LFG no-safe-default park state for ${taskId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
