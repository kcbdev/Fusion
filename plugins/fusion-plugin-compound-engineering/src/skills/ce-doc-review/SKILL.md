---
name: ce-doc-review
description: "Review Compound Engineering markdown or HTML plan documents for coherence, feasibility, and scope alignment. Use headless mode for automated plan handoff review; HTML is report-only."
argument-hint: "[mode:headless] <plan-or-requirements-path>"
---

# CE Document Review

Review a Compound Engineering markdown or HTML plan/requirements document. Markdown artifacts may receive safe markdown-only fixes; HTML artifacts are reviewed in report-only mode and are never mutated.

<!--
FNXC:CompoundEngineering 2026-06-27-00:00:
FN-7147 requires HTML artifacts to receive the same persona-lens document review as markdown artifacts while suppressing all in-file mutation. The report-only path replaces the prior behavior that skipped HTML entirely because markdown edit mechanics would corrupt rendered HTML plans.
-->

## Modes

- `mode:headless <path>`: run an automated advisory pass and return a concise review envelope. For markdown, apply only `safe_auto` markdown fixes; for HTML, report findings only and apply nothing.
- `<path>` without `mode:headless`: run the same review for an interactive caller. For markdown, include actionable findings clearly enough for the caller to decide what to apply; for HTML, present a report-only summary and do not offer apply or Append-to-Open-Questions write-back options.

## Review boundary

`ce-brainstorm` owns WHAT: product requirements, actors, flows, acceptance examples, and scope boundaries.

`ce-plan` owns HOW: technical decisions, implementation units, dependencies, risks, verification contract, and handoff posture.

`ce-doc-review` checks whether the document preserves that boundary and is usable by downstream `ce-work`, PR reviewers, and humans. Do not turn document review into code review; `ce-code-review` owns implementation diff review later in the pipeline.

## Procedure

1. Resolve the target path from the arguments. Prefer an explicit path. If no path is provided, inspect `docs/plans/` for the most recent markdown (`.md`) or HTML (`.html`) plan-like artifact and use that; if none exists, skip non-blockingly.
2. Classify the target type:
   - Markdown (`.md`): review with markdown-safe mutation enabled for `safe_auto` fixes only.
   - HTML (`.html`): review in report-only mode. Run the same document-quality and persona-lens checks, preserve classifications, return structured findings text, and set `fixes_applied`/`applied_fixes_count` to `0`. Do not run `safe_auto` writes, `gated_auto`/`manual` apply-set edits, or Append-to-Open-Questions write-back that inserts markdown `##`/`###` headings.
   - Any other type: skip non-blockingly and explain that only markdown and HTML CE plan/requirements artifacts are supported.
3. Read the document enough to evaluate structure and consistency. For long documents, scan headings first, then read the Goal Capsule/Product Contract/Plan/Implementation Units/Verification/Definition of Done sections as present. For HTML, use the rendered document text/semantic headings as review input; do not rewrite tags or inject markdown.
4. Check for:
   - Product scope drift: requirements or Product Contract rewritten without a clear preservation note.
   - HOW gaps: implementation units lacking files, dependencies, risks, or verification scenarios.
   - Coherence gaps: contradictory decisions, stale handoff instructions, duplicated or inconsistent artifact readiness metadata.
   - Feasibility gaps: sequencing that cannot work, missing prerequisite decisions, or verification that cannot prove the stated Definition of Done.
   - Markdown-only hygiene that is safe to fix automatically: broken heading levels, obvious duplicate blank lines, malformed checklists, or typo-level wording that does not change meaning. This check may produce report-only findings for HTML but must not edit HTML.
5. In headless mode, apply only `safe_auto` fixes directly to markdown files. Do not apply changes that alter product scope, technical decisions, acceptance criteria, or verification obligations; report those as findings. In HTML mode, apply no fixes of any class and return the review envelope with counts/classifications intact.
6. If findings remain, classify each as:
   - `proposed_fix`: a safe but non-trivial improvement the user may accept.
   - `decision`: a scope/technical judgment that needs human or planner choice.
   - `fyi`: useful observation that does not need routing.
7. Interactive routing:
   - Markdown: the caller may choose whether to apply proposed fixes, route decisions, or append unresolved items to Open Questions.
   - HTML: skip apply and Append-to-Open-Questions choices entirely. Present the findings as a report-only summary, recommend regenerating markdown only if the user wants in-file autofix/write-back, and leave the HTML artifact unchanged.
8. End with a concise summary and exactly one trailing JSON object on the final line.

## Output contract

Use this shape for the final line:

```json
{"verdict":"APPROVE|APPROVE_WITH_NOTES|REVISE","fixes_applied":0,"proposed_fixes_count":0,"decisions_count":0,"fyi_count":0,"notes":"short summary"}
```

- `APPROVE`: no actionable issues remain.
- `APPROVE_WITH_NOTES`: non-blocking observations or report-only HTML findings; this is the normal result for optional workflow use.
- `REVISE`: only for severe document issues that make downstream work unsafe or impossible. In the Fusion built-in workflow this skill is advisory/non-blocking, but the verdict still helps humans see severity.

For HTML report-only reviews, the JSON must still be emitted, `fixes_applied` must be `0`, and notes should mention that HTML was reviewed without autofix.

Do not wrap the final JSON in markdown fences.
