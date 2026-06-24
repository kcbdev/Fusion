import test from "node:test";
import assert from "node:assert/strict";

import {
  distillDeterministic,
  buildDistillationPrompt,
  DISTILLATION_SYSTEM_PROMPT,
} from "../lib/distill-release-notes.mjs";

// --- distillDeterministic ---

test("groups entries by category in display order", () => {
  const entries = [
    { summary: "Fix mobile keyboard popup.", category: "fix", legacy: false },
    { summary: "Add LOC backfill control.", category: "feature", legacy: false },
    { summary: "Fix stale agent assignments.", category: "fix", legacy: false },
    { summary: "Remove deprecated API.", category: "breaking", legacy: false },
  ];
  const { notes, source } = distillDeterministic(entries, "1.0.0");
  assert.equal(source, "deterministic");

  // Feature section comes first.
  const featureIdx = notes.indexOf("### New");
  const fixIdx = notes.indexOf("### Fixed");
  const breakingIdx = notes.indexOf("### Breaking");
  assert.ok(featureIdx > -1);
  assert.ok(featureIdx < fixIdx);
  assert.ok(fixIdx < breakingIdx);
});

test("omits empty categories", () => {
  const entries = [
    { summary: "Add feature X.", category: "feature", legacy: false },
  ];
  const { notes } = distillDeterministic(entries, "1.0.0");
  assert.match(notes, /### New/);
  assert.doesNotMatch(notes, /### Fixed/);
  assert.doesNotMatch(notes, /### Breaking/);
  assert.doesNotMatch(notes, /### Security/);
  assert.doesNotMatch(notes, /### Performance/);
});

test("groups multiple entries in same category", () => {
  const entries = [
    { summary: "Fix bug A.", category: "fix", legacy: false },
    { summary: "Fix bug B.", category: "fix", legacy: false },
    { summary: "Fix bug C.", category: "fix", legacy: false },
  ];
  const { notes } = distillDeterministic(entries, "1.0.0");
  assert.match(notes, /### Fixed/);
  assert.match(notes, /Fix bug A\./);
  assert.match(notes, /Fix bug B\./);
  assert.match(notes, /Fix bug C\./);
  // All three should be in the same section.
  const fixedSection = notes.split("### Fixed")[1];
  assert.ok(fixedSection.includes("Fix bug A."));
  assert.ok(fixedSection.includes("Fix bug B."));
  assert.ok(fixedSection.includes("Fix bug C."));
});

test("handles empty entries array", () => {
  const { notes, source } = distillDeterministic([], "1.0.0");
  assert.equal(source, "deterministic");
  assert.match(notes, /No changes in v1\.0\.0/);
});

test("handles null/undefined entries", () => {
  const { notes } = distillDeterministic(null, "1.0.0");
  assert.match(notes, /No changes/);
});

test("single entry produces well-formed notes", () => {
  const entries = [
    { summary: "Add cool feature.", category: "feature", legacy: false },
  ];
  const { notes } = distillDeterministic(entries, "2.0.0");
  assert.match(notes, /^### New\n\n- Add cool feature\.$/);
});

test("includes internal category when entries exist", () => {
  const entries = [
    { summary: "Refactor internal modules.", category: "internal", legacy: false },
  ];
  const { notes } = distillDeterministic(entries, "1.0.0");
  assert.match(notes, /### Internal/);
});

test("handles legacy entries with category defaulting to internal", () => {
  const entries = [
    { summary: "Fix a bug in the parser.", category: "internal", legacy: true },
    { summary: "Add new dashboard widget.", category: "feature", legacy: false },
  ];
  const { notes } = distillDeterministic(entries, "1.0.0");
  assert.match(notes, /### New/);
  assert.match(notes, /### Internal/);
  // Feature comes before internal in display order.
  assert.ok(notes.indexOf("### New") < notes.indexOf("### Internal"));
});

test("unknown category falls back to internal", () => {
  const entries = [
    { summary: "Mystery change.", category: "unknown_cat", legacy: false },
  ];
  const { notes } = distillDeterministic(entries, "1.0.0");
  assert.match(notes, /### Internal/);
  assert.match(notes, /Mystery change\./);
});

test("preserves entry order within categories", () => {
  const entries = [
    { summary: "First fix.", category: "fix", legacy: false },
    { summary: "Second fix.", category: "fix", legacy: false },
    { summary: "A feature.", category: "feature", legacy: false },
    { summary: "Third fix.", category: "fix", legacy: false },
  ];
  const { notes } = distillDeterministic(entries, "1.0.0");
  const fixedSection = notes.split("### Fixed")[1];
  const firstIdx = fixedSection.indexOf("First fix.");
  const secondIdx = fixedSection.indexOf("Second fix.");
  const thirdIdx = fixedSection.indexOf("Third fix.");
  assert.ok(firstIdx < secondIdx);
  assert.ok(secondIdx < thirdIdx);
});

test("multiple categories render in correct order", () => {
  const entries = [
    { summary: "Security patch.", category: "security", legacy: false },
    { summary: "New feature.", category: "feature", legacy: false },
    { summary: "Performance boost.", category: "performance", legacy: false },
    { summary: "Breaking change.", category: "breaking", legacy: false },
    { summary: "Bug fix.", category: "fix", legacy: false },
    { summary: "Internal cleanup.", category: "internal", legacy: false },
  ];
  const { notes } = distillDeterministic(entries, "1.0.0");
  const order = ["### New", "### Fixed", "### Breaking", "### Security", "### Performance", "### Internal"]
    .map((h) => notes.indexOf(h));
  // Each should be found and in ascending order.
  for (let i = 0; i < order.length - 1; i++) {
    assert.ok(order[i] > -1, `heading ${i} not found`);
    assert.ok(order[i] < order[i + 1], `headings ${i} and ${i + 1} out of order`);
  }
});

// --- buildDistillationPrompt ---

test("builds prompt with all entries", () => {
  const entries = [
    { summary: "Add feature.", category: "feature", legacy: false, dev: "Uses tool X." },
    { summary: "Fix bug.", category: "fix", legacy: false },
  ];
  const prompt = buildDistillationPrompt(entries);
  assert.match(prompt, /\[1\]/);
  assert.match(prompt, /\[2\]/);
  assert.match(prompt, /category: feature/);
  assert.match(prompt, /summary: Add feature\./);
  assert.match(prompt, /dev: Uses tool X\./);
});

test("builds prompt without dev for entries lacking it", () => {
  const entries = [
    { summary: "Fix bug.", category: "fix", legacy: false },
  ];
  const prompt = buildDistillationPrompt(entries);
  assert.doesNotMatch(prompt, /dev:/);
});

// --- DISTILLATION_SYSTEM_PROMPT ---

test("system prompt contains key instructions", () => {
  assert.match(DISTILLATION_SYSTEM_PROMPT, /release notes/i);
  assert.match(DISTILLATION_SYSTEM_PROMPT, /operator/i);
  assert.match(DISTILLATION_SYSTEM_PROMPT, /### New/);
  assert.match(DISTILLATION_SYSTEM_PROMPT, /### Fixed/);
  assert.match(DISTILLATION_SYSTEM_PROMPT, /omit empty sections/i);
});
