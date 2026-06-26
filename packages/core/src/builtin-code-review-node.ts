import type { WorkflowIrNode } from "./workflow-ir-types.js";
import { WORKFLOW_STEP_TEMPLATES } from "./types.js";

/*
FNXC:CodeReviewStep 2026-06-25-13:30:
Code Review is a STANDARD, always-on step in the built-in coding and stepwise-coding
workflows — NOT a default-off optional-group toggle. It is a regular `prompt` node on the
pre-merge success path (execute → [browser-verification optional] → code-review → review),
so it runs for EVERY coding task by default with no `enabledWorkflowSteps` gating.

gateMode is "advisory" (sourced from the catalog template): like the existing `review`
seam it does not change merge outcomes — it just adds the diff-correctness review to the
standard flow. Operators can promote it to a blocking gate later. toolMode is "readonly":
review reads the diff/files, it does not mutate the worktree.

The node id `code-review` is also the catalog template id, so the built-in node stays
byte-identical to the `code-review` template a human would insert from the editor palette
(prompt/toolMode/gateMode all sourced from the catalog).
*/

function resolveCodeReviewTemplate() {
  const tpl = WORKFLOW_STEP_TEMPLATES.find((t) => t.id === "code-review");
  if (!tpl) {
    throw new Error("code-review WORKFLOW_STEP_TEMPLATE is missing");
  }
  return tpl;
}

const CODE_REVIEW_TEMPLATE = resolveCodeReviewTemplate();

/** Standard pre-merge code-review node id (also the catalog template id). */
export const CODE_REVIEW_NODE_ID = "code-review";

/**
 * Build the standard, always-on `code-review` prompt node placed on a workflow's
 * pre-merge success path between browser-verification and review. `column` matches the
 * pre-merge implementation column (`in-progress`) so the single in-progress → in-review
 * status transition stays at code-review → review.
 *
 * Mirrors `stepTemplateToNode(code-review)`: a `prompt` node whose config carries the
 * catalog prompt + `toolMode: "readonly"` + `gateMode: "advisory"`.
 */
export function codeReviewStepNode(column: string): WorkflowIrNode {
  const tpl = CODE_REVIEW_TEMPLATE;
  return {
    id: CODE_REVIEW_NODE_ID,
    kind: "prompt",
    column,
    config: {
      name: tpl.name,
      description: tpl.description,
      prompt: tpl.prompt ?? "",
      toolMode: tpl.toolMode === "coding" ? "coding" : "readonly",
      gateMode: tpl.gateMode ?? "advisory",
    },
  };
}
