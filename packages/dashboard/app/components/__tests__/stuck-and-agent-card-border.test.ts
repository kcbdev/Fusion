import { describe, expect, it } from "vitest";
import { loadAllAppCss } from "../../test/cssFixture";

const css = loadAllAppCss();

type CssRule = {
  selector: string;
  body: string;
};

function allRules(): CssRule[] {
  return Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g), ([, selector, body]) => ({
    selector: selector.replace(/\/\*[\s\S]*?\*\//g, "").trim(),
    body: body.trim(),
  }));
}

function selectorParts(selector: string): string[] {
  return selector.split(",").map((part) => part.trim());
}

function rulesFor(selector: string): CssRule[] {
  return allRules().filter((rule) => selectorParts(rule.selector).includes(selector));
}

function baseRule(selector: string): string {
  const rule = rulesFor(selector).find((candidate) => !candidate.selector.startsWith("@"));
  expect(rule, `${selector} should have a CSS rule`).toBeTruthy();
  return rule?.body ?? "";
}

function expectNoEmptyVariantShell(selector: string, axis: "border-left-color" | "border-top-color"): void {
  for (const rule of rulesFor(selector)) {
    const body = rule.body.trim();
    expect(body, `${selector} must not leave an empty CSS rule shell`).not.toBe("");
    expect(body, `${selector} must not keep a colored edge override`).not.toContain(axis);
    expect(
      /(background|box-shadow|border:\s*1px\s+solid\s+var\(--border\))/.test(body),
      `${selector} rules should either be deleted or carry a non-stripe legibility declaration`,
    ).toBe(true);
  }
}

describe("stuck task and agent card colored edge borders (FN-6774)", () => {
  it("keeps stuck task board cards legible without a triage left stripe", () => {
    const stuckCard = baseRule(".card.stuck");

    expect(stuckCard).not.toContain("border-left: 3px solid var(--triage)");
    expect(stuckCard).not.toContain("border-left");
    expect(stuckCard).toContain("background: color-mix(in srgb, var(--triage) 6%, transparent)");
    expect(baseRule(".card-status-badge.stuck")).toContain("background: var(--status-triage-bg-deep)");
  });

  it("keeps stuck list rows legible without a triage left stripe", () => {
    const stuckRow = baseRule(".list-row.stuck");

    expect(stuckRow).not.toContain("border-left: 3px solid var(--triage)");
    expect(stuckRow).not.toContain("border-left");
    expect(stuckRow).toContain("background: color-mix(in srgb, var(--triage) 8%, transparent)");
    expect(baseRule(".list-status-badge.stuck")).toContain("background: color-mix(in srgb, var(--triage) 20%, transparent)");
  });

  it("uses neutral split-sidebar agent card borders across agent states", () => {
    const agentCard = baseRule(".agent-card");
    const selectedCard = baseRule(".agent-card--selected");

    expect(agentCard).toContain("border: 1px solid var(--border)");
    expect(agentCard).not.toContain("border-left-width: 4px");
    expect(selectedCard).not.toContain("border-left-color: var(--todo)");
    expect(selectedCard).not.toContain("!important");
    expect(selectedCard).toContain("box-shadow: inset 0 0 0 calc(var(--space-xs) / 4) var(--todo)");

    for (const state of ["active", "paused", "running", "error"]) {
      expectNoEmptyVariantShell(`.agent-card--${state}`, "border-left-color");
    }

    expect(css).not.toMatch(/\.agent-card--(?:idle|active|paused|running|error)\b[^{}]*\{[^}]*border-left-color/s);
  });

  it("uses neutral grid agent board card borders across agent states", () => {
    const boardCard = baseRule(".agent-board-card");

    expect(boardCard).toContain("border: 1px solid var(--border)");
    expect(boardCard).not.toContain("border-top-width: 3px");

    for (const state of ["active", "paused", "running", "error"]) {
      expectNoEmptyVariantShell(`.agent-board-card--${state}`, "border-top-color");
    }

    expect(css).not.toMatch(/\.agent-board-card--(?:idle|active|paused|running|error)\b[^{}]*\{[^}]*border-top-color/s);
  });
});
