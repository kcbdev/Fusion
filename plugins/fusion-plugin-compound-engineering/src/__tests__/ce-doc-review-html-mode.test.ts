import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const skillsRoot = fileURLToPath(new URL("../skills/", import.meta.url));

function readSkill(relativePath: string): string {
  return readFileSync(join(skillsRoot, relativePath), "utf8");
}

function expectNoLegacyHtmlSkipLanguage(surfaces: Record<string, string>): void {
  const forbidden = [
    /ce-doc-review is markdown-only today/i,
    /Requirements review unavailable in output:html mode/i,
    /review unavailable for HTML/i,
    /ce-doc-review is skipped/i,
    /skipped_reason:\s*output_format_html/i,
    /not currently an HTML consumer/i,
    /not a current HTML consumer/i,
    /skips? (?:the )?(?:5\.3\.8 )?(?:doc-review|document-review|ce-doc-review)[^\n.]*HTML/i,
    /HTML[^\n.]*skips? (?:the )?(?:doc-review|document-review|ce-doc-review)/i,
  ];

  for (const [name, content] of Object.entries(surfaces)) {
    for (const pattern of forbidden) {
      expect(content, `${name} must not contain legacy HTML-skip language matching ${pattern}`).not.toMatch(pattern);
    }
  }
}

/*
FNXC:CompoundEngineering 2026-06-27-18:31:
FN-7147 replaces the CE document-review HTML skip with a non-mutating report-only path. This guard reads the prompt-executed bundled skill text directly so future upstream refreshes cannot leave one handoff saying “skip HTML” while another routes HTML to review.
*/
describe("ce-doc-review HTML report-only mode", () => {
  const docReviewSkill = readSkill("ce-doc-review/SKILL.md");
  const planSkill = readSkill("ce-plan/SKILL.md");
  const planHandoff = readSkill("ce-plan/references/plan-handoff.md");
  const brainstormHandoff = readSkill("ce-brainstorm/references/handoff.md");

  it("documents that HTML doc review is report-only and non-mutating", () => {
    expect(docReviewSkill).toMatch(/HTML artifacts? (?:are reviewed|receive)[^\n.]*report-only/i);
    expect(docReviewSkill).toMatch(/same document-quality and persona-lens checks/i);
    expect(docReviewSkill).toMatch(/apply no fixes of any class/i);
    expect(docReviewSkill).toMatch(/Append-to-Open-Questions write-back that inserts markdown/i);
    expect(docReviewSkill).toMatch(/HTML artifacts are reviewed in report-only mode and are never mutated/i);
  });

  it("routes ce-plan HTML artifacts through report-only review instead of a skipped envelope", () => {
    expect(planHandoff).toMatch(/HTML plans use `ce-doc-review` in report-only mode/i);
    expect(planHandoff).toMatch(/applied_fixes_count = 0/i);
    expect(planHandoff).toMatch(/no `skipped_reason` field/i);
    expect(planHandoff).toMatch(/Free-form requests for review[^\n]*HTML plan in report-only mode/i);
  });

  it("keeps ce-plan SKILL.md aligned with report-only HTML review", () => {
    expect(planSkill).toMatch(/For HTML plans \(`OUTPUT_FORMAT=html`\)[^\n]*still runs ce-doc-review/i);
    expect(planSkill).toMatch(/HTML reviews are report-only and do not offer apply or Open Questions write-back/i);
    expect(planSkill).toMatch(/Document review is mandatory for markdown plans and report-only for HTML plans/i);
  });

  it("shows ce-brainstorm requirements review for HTML in report-only mode", () => {
    expect(brainstormHandoff).toMatch(/Shown when a unified plan artifact exists/i);
    expect(brainstormHandoff).toMatch(/Under `OUTPUT_FORMAT=html`, run `ce-doc-review` in report-only mode/i);
    expect(brainstormHandoff).toMatch(/This nudge applies to markdown and HTML artifacts/i);
    expect(brainstormHandoff).toMatch(/For `\.html` artifacts, state that the review is report-only/i);
  });

  it("removes old HTML markdown-only skip language from all edited review surfaces", () => {
    expectNoLegacyHtmlSkipLanguage({
      "ce-doc-review/SKILL.md": docReviewSkill,
      "ce-plan/SKILL.md": planSkill,
      "ce-plan/references/plan-handoff.md": planHandoff,
      "ce-brainstorm/references/handoff.md": brainstormHandoff,
      "ce-brainstorm/references/html-rendering.md": readSkill("ce-brainstorm/references/html-rendering.md"),
      "ce-ideate/references/html-rendering.md": readSkill("ce-ideate/references/html-rendering.md"),
      "ce-plan/references/html-rendering.md": readSkill("ce-plan/references/html-rendering.md"),
    });
  });
});
