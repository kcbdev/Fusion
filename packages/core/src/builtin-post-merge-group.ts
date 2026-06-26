import type { WorkflowIrNode } from "./workflow-ir-types.js";

/*
FNXC:WorkflowPostMerge 2026-06-26-09:00:
Factory for a POST-MERGE optional-group node — the graph-native execution mechanism
for post-merge workflow steps (U7 spike). Mirrors `codeReviewOptionalGroupNode` /
`browserVerificationOptionalGroupNode`, but the produced node carries
`config.phase: "post-merge"` so the graph executor:
  1. runs it only AFTER a successful merge (when wired off the merge region and the
     `graphNativePostMerge` flag is on), and
  2. records its WorkflowStepResult with `phase: "post-merge"` + emits `[post-merge]`
     logs (failures are NON-BLOCKING — the merged task still completes).

There are NO built-in post-merge steps today, so this factory is intentionally generic
and is NOT wired into `builtin:coding` (which stays byte-identical, the parity oracle).
It is the reusable builder migrated/custom workflows (and the new test) use to author a
post-merge step. The group node id is the STABLE per-task enable key (`enabledWorkflowSteps`),
and the inner template node carries a DISTINCT id (`${id}-step`) — a template node id may
not collide with the group/top-level node id (optional-group validation).
*/

export interface PostMergeOptionalGroupSpec {
  /** Stable per-task enable key + group node id. */
  id: string;
  /** Display name (toggle/editor surfaces + recorded `workflowStepName`). */
  name: string;
  /** Column the group node sits in (typically a post-merge/`done` column). */
  column: string;
  /** Agent prompt for the inner post-merge step. */
  prompt: string;
  /** Optional short description for the inner node. */
  description?: string;
  /** Inner step tool access; defaults to "readonly". */
  toolMode?: "readonly" | "coding";
  /** Gate semantics; defaults to "advisory" (post-merge failures are non-blocking). */
  gateMode?: "advisory" | "gate";
  /** Seed the per-task enable toggle for new tasks; defaults to false (opt-in). */
  defaultOn?: boolean;
}

/**
 * Build a post-merge `optional-group` node. The node config is marked
 * `phase: "post-merge"` so the graph executor's optional-group recording path keys
 * the result phase + log prefix off it.
 */
export function postMergeOptionalGroupNode(spec: PostMergeOptionalGroupSpec): WorkflowIrNode {
  return {
    id: spec.id,
    kind: "optional-group",
    column: spec.column,
    config: {
      name: spec.name,
      phase: "post-merge",
      defaultOn: spec.defaultOn ?? false,
      template: {
        nodes: [
          {
            id: `${spec.id}-step`,
            kind: "prompt",
            config: {
              name: spec.name,
              ...(spec.description !== undefined ? { description: spec.description } : {}),
              prompt: spec.prompt,
              toolMode: spec.toolMode ?? "readonly",
              gateMode: spec.gateMode ?? "advisory",
            },
          },
        ],
        edges: [],
      },
    },
  };
}
