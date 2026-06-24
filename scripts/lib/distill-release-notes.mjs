/*
 * FNXC:Changelog 2026-06-24-15:30:
 * Release-notes distiller. Takes parsed changeset entries and produces
 * grouped, end-user-facing release notes organized by category. The
 * deterministic mode renders a clean category-grouped bullet list from
 * structured summaries. The AI mode (optional, added in U4) calls
 * createFnAgent for polished prose. When the AI call fails or is
 * unavailable, the deterministic output is the fallback so a model
 * outage never blocks a release.
 */

import { CATEGORIES, CATEGORY_HEADINGS } from "./changeset-schema.mjs";

/**
 * Deterministic distillation: groups parsed changeset entries by category
 * and renders clean markdown release notes.
 *
 * Categories are rendered in display order (feature → fix → breaking →
 * security → performance → internal). Empty categories are omitted.
 * The `internal` category is included only when it carries entries, since
 * operators generally don't need internal-only changes surfaced — but it
 * is not suppressed entirely because some releases are internal-only.
 *
 * @param {Array<{summary: string, category: string, dev?: string, legacy: boolean}>} entries
 * @param {string} version
 * @returns {{notes: string, source: "deterministic"}}
 */
export function distillDeterministic(entries, version) {
  if (!entries || entries.length === 0) {
    return { notes: `No changes in v${version}.`, source: "deterministic" };
  }

  const grouped = groupByCategory(entries);
  const sections = [];

  for (const category of CATEGORIES) {
    const items = grouped.get(category);
    if (!items || items.length === 0) continue;

    const heading = CATEGORY_HEADINGS[category];
    const bullets = items.map((entry) => `- ${entry.summary}`);
    sections.push(`### ${heading}\n\n${bullets.join("\n")}`);
  }

  return {
    notes: sections.join("\n\n"),
    source: "deterministic",
  };
}

/**
 * Group entries by category, preserving input order within each group.
 */
function groupByCategory(entries) {
  const grouped = new Map();
  for (const category of CATEGORIES) {
    grouped.set(category, []);
  }
  for (const entry of entries) {
    const cat = CATEGORIES.includes(entry.category) ? entry.category : "internal";
    grouped.get(cat)?.push(entry);
  }
  return grouped;
}

/**
 * Build the context prompt for AI distillation. This is used by the AI
 * mode (U4) when calling createFnAgent. Exported separately so the prompt
 * can be tested without a model call.
 *
 * @param {Array<{summary: string, category: string, dev?: string, legacy: boolean}>} entries
 * @returns {string}
 */
export function buildDistillationPrompt(entries) {
  const lines = entries.map((entry, i) => {
    const parts = [`[${i + 1}] category: ${entry.category}`, `summary: ${entry.summary}`];
    if (entry.dev) {
      parts.push(`dev: ${entry.dev}`);
    }
    return parts.join("\n");
  });
  return lines.join("\n\n");
}

/**
 * System prompt for AI distillation. Exported for testing and tuning.
 */
export const DISTILLATION_SYSTEM_PROMPT = [
  "You are a release notes writer for Fusion, an AI agent orchestration tool.",
  "Your audience is Fusion operators (developers using the tool), not internal engineers.",
  "Given structured changeset entries, produce grouped markdown release notes.",
  "Group under these headings: ### New, ### Fixed, ### Breaking, ### Performance, ### Security.",
  "Omit empty sections. Use bullet points.",
  "Write clear, concise, user-facing summaries. No internal class names or implementation detail.",
  "Output only the markdown release notes, no preamble or explanation.",
].join("\n");
