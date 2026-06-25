/*
 * FNXC:Changelog 2026-06-24-15:30:
 * Release-notes distillation module. Transforms parsed changeset entries
 * into grouped, end-user-facing release notes. The deterministic fallback
 * builds a category-grouped bullet list directly from the structured
 * `summary` fields — no model call. When a model is available, the prompt
 * and system prompt defined here can be used to produce curated, polished
 * notes via `createFnAgent`.
 *
 * Audience is Fusion operators: behavior, fixes, what changed — minimal
 * internals. The `dev` field is preserved in per-package CHANGELOGs but
 * excluded from distilled release notes by default.
 */

import { CATEGORIES, CATEGORY_HEADINGS } from "./changeset-schema.mjs";

/**
 * System prompt for AI distillation via `createFnAgent`.
 * Instructs the model to produce grouped markdown release notes for a
 * Fusion operator audience, using only the `summary` fields as input.
 */
export const DISTILLATION_SYSTEM_PROMPT = [
  "You are a release-notes writer for Fusion, a model-agnostic AI agent orchestration product.",
  "Your audience is Fusion operators — developers using the product, not its internals.",
  "Produce clean, grouped markdown release notes from the provided changeset entries.",
  "Group under these headings (omit empty sections):",
  "  ### New (features)",
  "  ### Fixed (bug fixes)",
  "  ### Breaking (breaking changes)",
  "  ### Security (security fixes)",
  "  ### Performance (performance improvements)",
  "  ### Internal (internal-only changes)",
  "Rules:",
  "- Use the `summary` text verbatim or lightly edited for clarity and grouping.",
  "- Do NOT include internal class names, file paths, or implementation detail.",
  "- Do NOT include the `dev` field content unless it is user-relevant migration guidance.",
  "- Write one bullet per entry, prefixed with `- `.",
  "- Omit empty sections entirely.",
  "- Do NOT add a title or version heading — only the grouped sections.",
  "- Respond with markdown only, no preamble or explanation.",
].join("\n");

/**
 * Build the user-facing prompt for AI distillation.
 * Lists each entry as `[N] category: X / summary: Y / dev: Z`.
 *
 * @param {Array<{summary: string, category: string, dev?: string, legacy?: boolean}>} entries
 * @returns {string}
 */
export function buildDistillationPrompt(entries) {
  const lines = ["Produce release notes from these changeset entries:\n"];
  entries.forEach((entry, i) => {
    const num = i + 1;
    lines.push(`[${num}]`);
    lines.push(`  category: ${entry.category}`);
    lines.push(`  summary: ${entry.summary}`);
    if (entry.dev) {
      lines.push(`  dev: ${entry.dev}`);
    }
    lines.push("");
  });
  return lines.join("\n");
}

/**
 * Deterministic fallback: build category-grouped release notes directly
 * from the structured `summary` fields — no model call.
 *
 * Used when:
 * - The model call fails, times out, or returns unparseable output
 * - No model is configured (CI without model secret)
 * - As a pre-model preview in dry-runs
 *
 * @param {Array<{summary: string, category: string, legacy?: boolean}>} entries
 * @param {string} version - Target version string (e.g. "0.47.0")
 * @returns {{notes: string, source: "deterministic"}}
 */
export function distillDeterministic(entries, version) {
  if (!entries || entries.length === 0) {
    return {
      notes: `No changes in v${version}.`,
      source: "deterministic",
    };
  }

  // Group entries by category, preserving entry order within each group.
  const groups = new Map();
  for (const cat of CATEGORIES) {
    groups.set(cat, []);
  }

  for (const entry of entries) {
    const cat = groups.has(entry.category) ? entry.category : "internal";
    groups.get(cat).push(entry.summary);
  }

  // Build sections in display order, omitting empty categories.
  const sections = [];
  for (const cat of CATEGORIES) {
    const summaries = groups.get(cat);
    if (summaries.length === 0) continue;

    const heading = CATEGORY_HEADINGS[cat];
    const bullets = summaries.map((s) => `- ${s}`).join("\n");
    sections.push(`### ${heading}\n\n${bullets}`);
  }

  return {
    notes: sections.join("\n\n"),
    source: "deterministic",
  };
}
