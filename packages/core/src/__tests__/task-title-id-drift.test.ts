import { describe, expect, it } from "vitest";
import { MAX_TITLE_LENGTH } from "../ai-summarize.js";
import { extractTaskIdTokens, hasTitleIdDrift, normalizeTitleForTaskId } from "../task-title-id-drift.js";

describe("task-title-id-drift", () => {
  it("extracts uppercase fn ids", () => {
    expect(extractTaskIdTokens("foo fn-1 and FN-2")).toEqual(["FN-1", "FN-2"]);
  });

  it("keeps title when it contains row id", () => {
    expect(normalizeTitleForTaskId("Fix FN-999 bug", "FN-999")).toEqual({ title: "Fix FN-999 bug", changed: false });
  });

  it("keeps title when one of multiple ids matches row id", () => {
    expect(normalizeTitleForTaskId("Fix FN-100 and FN-999", "FN-999").changed).toBe(false);
  });

  it("returns null when stripping empties title", () => {
    expect(normalizeTitleForTaskId("FN-123", "FN-999")).toEqual({ title: null, changed: true });
  });

  it("handles refinement prefix", () => {
    expect(normalizeTitleForTaskId("Refinement: FN-4847: foo", "FN-9999")).toEqual({ title: "Refinement: foo", changed: true });
  });

  it("matches case-insensitive and respects word boundaries", () => {
    expect(hasTitleIdDrift("Fix fn-123", "FN-999")).toBe(true);
    expect(normalizeTitleForTaskId("XFN-123Y", "FN-999").changed).toBe(false);
  });

  it("passes through undefined/blank/non-fn", () => {
    expect(normalizeTitleForTaskId(undefined, "FN-1")).toEqual({ title: null, changed: false });
    expect(normalizeTitleForTaskId("", "FN-1")).toEqual({ title: "", changed: false });
    expect(normalizeTitleForTaskId("hello", "FN-1")).toEqual({ title: "hello", changed: false });
  });

  it("caps title length", () => {
    const long = `prefix FN-100 ${"x".repeat(MAX_TITLE_LENGTH + 60)}`;
    const normalized = normalizeTitleForTaskId(long, "FN-999");
    expect(normalized.title!.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
  });

  it("collapses whitespace", () => {
    expect(normalizeTitleForTaskId("Fix  FN-100   bug", "FN-999")).toEqual({ title: "Fix bug", changed: true });
  });

  it("cleans trailing punctuation", () => {
    expect(normalizeTitleForTaskId("Foo FN-100:", "FN-999")).toEqual({ title: "Foo", changed: true });
  });

  it("strips empty placeholder left by fn-token removal (FN-4978 regression)", () => {
    const normalized = normalizeTitleForTaskId("Fix executor.ts stale session deadlock (FN-1234)", "FN-9999");
    expect(normalized).toEqual({ title: "Fix executor.ts stale session deadlock", changed: true });
    expect(normalized.title).not.toContain("(");
    expect(normalized.title).not.toContain(")");
  });

  it("strips empty square and curly bracket placeholders", () => {
    expect(normalizeTitleForTaskId("Bug [FN-1] thing", "FN-9")).toEqual({ title: "Bug thing", changed: true });
    expect(normalizeTitleForTaskId("Bug {FN-1} thing", "FN-9")).toEqual({ title: "Bug thing", changed: true });
  });

  it("preserves valid qualifiers and matching row id token", () => {
    expect(normalizeTitleForTaskId("Refactor parser (hotfix)", "FN-9")).toEqual({
      title: "Refactor parser (hotfix)",
      changed: false,
    });
    expect(normalizeTitleForTaskId("Add docs (FN-9)", "FN-9")).toEqual({
      title: "Add docs (FN-9)",
      changed: false,
    });
  });

  it("is idempotent", () => {
    const first = normalizeTitleForTaskId("Refinement: FN-100: foo", "FN-200");
    const second = normalizeTitleForTaskId(first.title ?? "", "FN-200");
    expect(second.changed).toBe(false);

    const firstPlaceholderPass = normalizeTitleForTaskId("Fix executor.ts stale session deadlock (FN-1234)", "FN-9999");
    const secondPlaceholderPass = normalizeTitleForTaskId(firstPlaceholderPass.title ?? "", "FN-9999");
    expect(secondPlaceholderPass.changed).toBe(false);
  });
});
