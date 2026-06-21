import { BUILTIN_CODING_WORKFLOW_IR } from "./builtin-coding-workflow-ir.js";
import { BUILTIN_LEAD_GENERATION_WORKFLOW_IR } from "./builtin-lead-generation-workflow-ir.js";
import { BUILTIN_MARKETING_WORKFLOW_IR } from "./builtin-marketing-workflow-ir.js";
import { BUILTIN_PR_WORKFLOW_IR } from "./builtin-pr-workflow-ir.js";
import { BUILTIN_STEPWISE_CODING_WORKFLOW_IR } from "./builtin-stepwise-coding-workflow-ir.js";
import { BUILTIN_WORKFLOW_SETTINGS } from "./builtin-workflow-settings.js";
import { builtinPromptConfig } from "./builtin-workflow-prompts.js";
import type { WorkflowDefinition } from "./workflow-definition-types.js";
import type { WorkflowIr } from "./workflow-ir-types.js";
import { parseWorkflowIr } from "./workflow-ir.js";

/** Prefix marking a workflow as a read-only built-in template. */
export const BUILTIN_WORKFLOW_ID_PREFIX = "builtin:";

export function isBuiltinWorkflowId(id: string): boolean {
  return id.startsWith(BUILTIN_WORKFLOW_ID_PREFIX);
}

const PLUGIN_GATED_BUILTIN_WORKFLOWS: ReadonlyMap<string, string> = new Map([
  ["builtin:compound-engineering", "fusion-plugin-compound-engineering"],
]);

export function isBuiltinWorkflowPluginGated(id: string): boolean {
  return PLUGIN_GATED_BUILTIN_WORKFLOWS.has(id);
}

export function getRequiredPluginIdForBuiltinWorkflow(id: string): string | undefined {
  return PLUGIN_GATED_BUILTIN_WORKFLOWS.get(id);
}

export function defaultEnabledBuiltinWorkflowIds(): string[] {
  return BUILTIN_WORKFLOWS.filter(
    (workflow) => workflow.kind !== "fragment" && !PLUGIN_GATED_BUILTIN_WORKFLOWS.has(workflow.id),
  ).map((workflow) => workflow.id);
}

export function isBuiltinWorkflowEnabled(id: string, enabledIds?: readonly string[]): boolean {
  if (!isBuiltinWorkflowId(id)) return true;
  if (!enabledIds) return true;
  return enabledIds.includes(id);
}

// Stable timestamp so built-ins round-trip deterministically.
const BUILTIN_TS = "2026-01-01T00:00:00.000Z";

interface BuiltinSpec {
  id: string;
  name: string;
  description: string;
  /** Ordered node specs between start and end; seams use {seam}. */
  nodes: Array<{ id: string; kind: WorkflowIr["nodes"][number]["kind"]; config?: Record<string, unknown> }>;
}

/** Build a linear IR (start → nodes… → end) with simple x-spaced layout. */
function linear(spec: BuiltinSpec): WorkflowDefinition {
  const nodes: WorkflowIr["nodes"] = [
    { id: "start", kind: "start" },
    ...spec.nodes,
    { id: "end", kind: "end" },
  ];
  const edges: WorkflowIr["edges"] = [];
  for (let i = 0; i < nodes.length - 1; i += 1) {
    edges.push({ from: nodes[i].id, to: nodes[i + 1].id, condition: "success" });
  }
  // Seam nodes also fail straight to end (mirrors the legacy pipeline).
  for (const node of spec.nodes) {
    if (typeof node.config?.seam === "string") {
      edges.push({ from: node.id, to: "end", condition: "failure" });
    }
  }
  const layout: Record<string, { x: number; y: number }> = {};
  nodes.forEach((node, i) => {
    layout[node.id] = { x: 60 + i * 170, y: 160 };
  });
  const ir = parseWorkflowIr({ version: "v1", name: spec.name, nodes, edges });
  // Attach the moved-key settings catalog (U1/U3, R4) so every built-in workflow
  // carries its declarations through the resolver path (resolveWorkflowIrById →
  // resolveEffectiveSettings). v1 graphs upgrade to v2 on parse, so the parsed IR
  // is v2 and can carry `settings`. Defaults are byte-equal to legacy
  // DEFAULT_PROJECT_SETTINGS literals, so this is behavior-inert.
  if (ir.version === "v2") {
    ir.settings = BUILTIN_WORKFLOW_SETTINGS;
  }
  return {
    id: spec.id,
    name: spec.name,
    description: spec.description,
    // Linear built-ins remain selectable workflows; catalog entries authored
    // directly below may opt into fragment kind when they are palette templates.
    kind: "workflow",
    ir,
    layout,
    createdAt: BUILTIN_TS,
    updatedAt: BUILTIN_TS,
  };
}

/**
 * Read-only built-in workflow templates. Selectable like any workflow; they
 * cannot be edited or deleted. In compile mode (flag off) only the custom
 * prompt/script/gate nodes become WorkflowSteps; the execute/review/merge
 * seams are honored only by the graph interpreter (flag on).
 */
export const BUILTIN_WORKFLOWS: WorkflowDefinition[] = [
  {
    id: "builtin:coding",
    name: "Coding (built-in)",
    description: "The standard coding pipeline: implement, review, then merge. Equivalent to the default behavior.",
    kind: "workflow",
    ir: BUILTIN_CODING_WORKFLOW_IR,
    layout: {
      start: { x: 60, y: 160 },
      execute: { x: 230, y: 160 },
      review: { x: 400, y: 160 },
      "merge-gate": { x: 570, y: 160 },
      "branch-group-member-integration": { x: 740, y: 80 },
      "branch-group-promotion": { x: 910, y: 80 },
      "merge-attempt": { x: 1080, y: 160 },
      "merge-retry": { x: 1250, y: 80 },
      "recovery-router": { x: 1250, y: 240 },
      "merge-manual-hold": { x: 740, y: 240 },
      end: { x: 1420, y: 160 },
    },
    createdAt: BUILTIN_TS,
    updatedAt: BUILTIN_TS,
  },
  linear({
    id: "builtin:quick-fix",
    name: "Quick fix (built-in)",
    description: "Implement and merge with no review step — for trivial, low-risk changes.",
    nodes: [
      { id: "execute", kind: "prompt", config: builtinPromptConfig("execute", "Execute") },
      { id: "merge", kind: "prompt", config: builtinPromptConfig("merge", "Merge boundary") },
    ],
  }),
  linear({
    id: "builtin:review-heavy",
    name: "Review-heavy (built-in)",
    description: "Adds an extra security pass before merge, on top of the standard review.",
    nodes: [
      { id: "execute", kind: "prompt", config: builtinPromptConfig("execute", "Execute") },
      { id: "review", kind: "prompt", config: builtinPromptConfig("review", "Review") },
      {
        id: "security",
        kind: "gate",
        config: {
          name: "Security review",
          gateMode: "gate",
          prompt: "Review the diff for security issues: injection, auth/authorization gaps, secret handling, unsafe deserialization. Block on any exploitable finding.",
        },
      },
      { id: "merge", kind: "prompt", config: builtinPromptConfig("merge", "Merge boundary") },
    ],
  }),
  {
    id: "builtin:marketing",
    name: "Marketing (built-in)",
    description: "Marketing content pipeline: ideate, brief, draft, editorial review, then publish via the standard lifecycle merge primitives.",
    kind: "workflow",
    ir: BUILTIN_MARKETING_WORKFLOW_IR,
    layout: {
      start: { x: 60, y: 160 },
      brief: { x: 230, y: 160 },
      draft: { x: 400, y: 160 },
      editorial: { x: 570, y: 160 },
      "merge-gate": { x: 740, y: 160 },
      "branch-group-member-integration": { x: 910, y: 80 },
      "branch-group-promotion": { x: 1080, y: 80 },
      "merge-attempt": { x: 1250, y: 160 },
      "merge-retry": { x: 1420, y: 80 },
      "recovery-router": { x: 1420, y: 240 },
      "merge-manual-hold": { x: 910, y: 240 },
      end: { x: 1590, y: 160 },
    },
    createdAt: BUILTIN_TS,
    updatedAt: BUILTIN_TS,
  },
  linear({
    id: "builtin:compound-engineering",
    name: "Compound engineering (built-in)",
    description: "Plan → implement → review → document, invoking the compound-engineering skills at each stage.",
    nodes: [
      {
        id: "plan",
        kind: "prompt",
        config: {
          name: "Plan",
          executor: "skill",
          skillName: "compound-engineering:ce-plan",
          // Coding mode so ce-plan can fan out to its research subagents via
          // fn_spawn_agent (registered only for coding-mode steps). It is not
          // meant to write — see the accepted write-capability posture (Risk-1).
          toolMode: "coding",
          prompt: "Produce a short implementation plan for this task before any code is written.",
        },
      },
      {
        id: "execute",
        kind: "prompt",
        config: {
          name: "Execute",
          executor: "skill",
          skillName: "compound-engineering:ce-work",
          // Coding mode so the step has write + spawn tools (readonly is the
          // default and would strip them). ce-work does the implementation the
          // CE way instead of the generic executor seam.
          toolMode: "coding",
          prompt: "Execute the plan for this task, following existing patterns and maintaining quality throughout.",
        },
      },
      { id: "review", kind: "prompt", config: builtinPromptConfig("review", "Review") },
      {
        id: "code-review",
        kind: "gate",
        config: {
          name: "Code review",
          executor: "skill",
          skillName: "compound-engineering:ce-code-review",
          gateMode: "gate",
          // Coding mode so ce-code-review can fan out to its reviewer-persona
          // subagents via fn_spawn_agent. As a gate step it still emits the
          // verdict JSON (KTD-6); it is not meant to write the tree (Risk-1).
          toolMode: "coding",
          prompt: "Run a structured code review of the changes. Block merge on P0/P1 findings.",
        },
      },
      {
        id: "commit-pr",
        kind: "prompt",
        config: {
          name: "Commit & open PR",
          executor: "skill",
          skillName: "compound-engineering:ce-commit-push-pr",
          // Coding mode: this step runs git + gh. Per KTD-6 it OWNS commit /
          // push / PR creation; it does NOT perform the board-state merge — that
          // stays with Fusion's merge seam below (workflow-owned merge), so the
          // two never race the same branch state.
          toolMode: "coding",
          prompt: "Commit the work in logical commits, push the branch, and open a pull request with a value-first description.",
        },
      },
      {
        id: "resolve-feedback",
        kind: "prompt",
        config: {
          name: "Resolve PR feedback",
          executor: "skill",
          skillName: "compound-engineering:ce-resolve-pr-feedback",
          toolMode: "coding",
          // Resolves open PR review threads. On the first autonomous pass there
          // may be no feedback yet (review is async); the skill no-ops when there
          // are no threads, and a re-run picks up later feedback.
          prompt: "Resolve open PR review feedback: evaluate each thread, fix valid issues, and reply.",
        },
      },
      { id: "merge", kind: "prompt", config: builtinPromptConfig("merge", "Merge boundary") },
      {
        id: "document",
        kind: "prompt",
        config: {
          name: "Document learnings",
          executor: "skill",
          skillName: "compound-engineering:ce-compound",
          // Coding mode so ce-compound can WRITE the learning doc into
          // docs/solutions (readonly would strip write tools).
          toolMode: "coding",
          prompt: "Capture any reusable learnings from this task into docs/solutions.",
        },
      },
    ],
  }),
  // The stepwise coding workflow (KTD-9) — step inversion as authored graph
  // structure (parse-steps → foreach{ step-execute → step-review } → review →
  // merge). Authored directly as a v2 IR (the `linear` helper only builds simple
  // pipelines); it is read-only like every built-in. Requires the
  // `workflowGraphExecutor` flag at run time (foreach/step-review/parse-steps are
  // interpreter-only node kinds, KTD-8); under the flag-off compile path its
  // step-inversion nodes are skipped, the same posture as the other seam nodes.
  {
    id: "builtin:stepwise-coding",
    name: "Stepwise coding (built-in)",
    description:
      "Per-step plan, execute, and review modeled as graph structure: each planned step runs and is reviewed (approve / revise / rethink) before the next, with bounded rework. Requires the workflow graph executor.",
    kind: "workflow",
    ir: BUILTIN_STEPWISE_CODING_WORKFLOW_IR,
    layout: {
      start: { x: 60, y: 160 },
      plan: { x: 230, y: 160 },
      parse: { x: 400, y: 160 },
      steps: { x: 570, y: 160 },
      "rework-hold": { x: 570, y: 320 },
      review: { x: 740, y: 160 },
      merge: { x: 910, y: 160 },
      end: { x: 1080, y: 160 },
    },
    createdAt: BUILTIN_TS,
    updatedAt: BUILTIN_TS,
  },
  /**
   * FNXC:Workflows 2026-06-20-00:00:
   * Fusion needs a built-in design lane for UI-heavy work. Gate changes on the frontend-ux-design review criteria before the standard review and merge so visual hierarchy, spacing, typography, token consistency, component reuse, responsive behavior, and fit with the design language are checked without custom workflow assembly.
   */
  linear({
    id: "builtin:design",
    name: "Design (built-in)",
    description: "Implement, then run a design/UX review gate before the standard review and merge — for UI-heavy work.",
    nodes: [
      { id: "execute", kind: "prompt", config: builtinPromptConfig("execute", "Execute") },
      {
        id: "design-review",
        kind: "gate",
        config: {
          name: "Design review",
          gateMode: "gate",
          prompt:
            "You are a UX design reviewer. Review frontend/UI changes for visual polish and consistency with existing UI patterns and design tokens. Check visual hierarchy and information flow; spacing, typography, margins, padding, gaps, and type scale; color and token consistency, including CSS custom properties/design tokens and no hardcoded colors; reuse of existing components instead of one-off styling or duplication; responsive behavior across viewports; and fit with the product design language, including border radius, shadows, transitions, and icon style. Block merge on real visual-quality regressions such as layout breaks, broken responsive behavior, hardcoded color/token violations, inconsistent component patterns, or design-language mismatches. Do not block or nit when the diff has no frontend/UI impact or no real design issue exists.",
        },
      },
      { id: "review", kind: "prompt", config: builtinPromptConfig("review", "Review") },
      { id: "merge", kind: "prompt", config: builtinPromptConfig("merge", "Merge boundary") },
    ],
  }),
  // The PR workflow (U9) — the unified PR-entity lifecycle wired end to end as
  // first-class graph nodes/edges: pr-create → await-review (hold) → pr-respond
  // (bounded rework loop) → auto-merge gate → pr-merge → end, with the await
  // states modeled as hold columns the U4 reconcile advances via external-event
  // releases. Authored directly as a v2 IR (the `linear` helper only builds
  // simple pipelines); read-only like every built-in. Requires the
  // `workflowGraphExecutor` flag at run time (pr-* node kinds, holds, and the
  // top-level rework loop are interpreter-only).
  //
  // ADDITIVE: this is a NEW built-in alongside the unchanged default
  // `builtin:coding`. Full retirement of the legacy comment/monitor PR path is
  // deferred until the graph executor is the default (see the plan's "Deferred to
  // follow-up work").
  {
    id: "builtin:pr-workflow",
    name: "PR lifecycle (built-in)",
    description:
      "The unified PR lifecycle as graph nodes: create the PR, await review, respond to changes (bounded rework loop), gate on auto-merge, then merge — with GitHub reconciliation advancing the await holds. Requires the workflow graph executor.",
    kind: "fragment",
    ir: BUILTIN_PR_WORKFLOW_IR,
    layout: {
      start: { x: 60, y: 160 },
      "pr-create": { x: 230, y: 160 },
      failed: { x: 230, y: 320 },
      "await-review": { x: 400, y: 160 },
      "pr-respond": { x: 400, y: 320 },
      "await-review-hold": { x: 570, y: 320 },
      gate: { x: 570, y: 160 },
      "await-rebase": { x: 740, y: 320 },
      "pr-merge": { x: 740, y: 160 },
      end: { x: 910, y: 160 },
    },
    createdAt: BUILTIN_TS,
    updatedAt: BUILTIN_TS,
  },
  {
    id: "builtin:lead-generation",
    name: "Lead generation (built-in)",
    description:
      "A business pipeline for sourcing, qualifying, enriching, and contacting leads with custom lead fields and stage columns. Requires the workflow graph executor for custom board columns.",
    kind: "workflow",
    ir: BUILTIN_LEAD_GENERATION_WORKFLOW_IR,
    layout: {
      start: { x: 60, y: 160 },
      "source-prospects": { x: 230, y: 160 },
      "qualify-lead": { x: 400, y: 160 },
      "qualification-gate": { x: 570, y: 160 },
      "enrich-lead": { x: 740, y: 160 },
      "draft-outreach": { x: 910, y: 160 },
      end: { x: 1080, y: 160 },
    },
    createdAt: BUILTIN_TS,
    updatedAt: BUILTIN_TS,
  },
];

const BUILTIN_BY_ID = new Map(BUILTIN_WORKFLOWS.map((wf) => [wf.id, wf]));

export function getBuiltinWorkflow(id: string): WorkflowDefinition | undefined {
  return BUILTIN_BY_ID.get(id);
}
