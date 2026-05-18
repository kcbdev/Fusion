import { MAX_TITLE_LENGTH } from "./ai-summarize.js";

export const TASK_ID_TOKEN_RE = /\bFN-(\d+)\b/gi;

const CONNECTOR_RE = /[:\-—–]/;
const EMPTY_PLACEHOLDER_CONTENT_RE = /^[\s,:;\-—–.!?]*$/;

export function stripEmptyPlaceholders(text: string): string {
  let normalized = text;

  // Remove empty bracketed placeholders ((), [], {}) that contain only
  // whitespace or punctuation residue/connectors.
  normalized = normalized.replace(/\(([^)]*)\)|\[([^\]]*)\]|\{([^}]*)\}/g, (match, paren, square, brace) => {
    const content = (paren ?? square ?? brace ?? "").trim();
    return EMPTY_PLACEHOLDER_CONTENT_RE.test(content) ? " " : match;
  });

  normalized = normalized
    .replace(/\s+([,:;.!?])/g, "$1")
    .replace(/([:\-—–])\s*(?=[:\-—–])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  normalized = normalized
    .replace(new RegExp(`(?:\\s*${CONNECTOR_RE.source}\\s*)+$`), "")
    .replace(/[,:;.!?]+$/g, "")
    .trim();

  return normalized;
}

export function extractTaskIdTokens(title: string): string[] {
  const tokens = new Set<string>();
  for (const match of title.matchAll(TASK_ID_TOKEN_RE)) {
    const raw = match[0];
    if (raw) {
      tokens.add(raw.toUpperCase());
    }
  }
  return [...tokens];
}

export function hasTitleIdDrift(title: string | undefined | null, rowId: string): boolean {
  if (!title) return false;
  const tokens = extractTaskIdTokens(title);
  if (tokens.length === 0) return false;
  const normalizedRowId = rowId.toUpperCase();
  return !tokens.some((token) => token === normalizedRowId);
}

export function normalizeTitleForTaskId(
  title: string | undefined | null,
  rowId: string,
): { title: string | null; changed: boolean } {
  const initial = title ?? null;
  if (initial === null || initial.length === 0) {
    return { title: initial, changed: false };
  }
  if (!hasTitleIdDrift(initial, rowId)) {
    return { title: initial, changed: false };
  }

  let normalized = initial.replace(/\bFN-\d+\b\s*([:\-—–])?\s*/gi, " ");
  normalized = stripEmptyPlaceholders(normalized);

  if (normalized.length > MAX_TITLE_LENGTH) {
    normalized = normalized.slice(0, MAX_TITLE_LENGTH).trim();
  }

  const nextTitle = normalized.length > 0 ? normalized : null;
  return { title: nextTitle, changed: nextTitle !== initial };
}
