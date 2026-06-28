import { lstatSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { randomUUID } from "node:crypto";
import { parse, parseFragment, serialize, serializeOuter, type DefaultTreeAdapterTypes } from "parse5";

const MAX_ARTIFACT_BYTES = 2_000_000;
const STABLE_SECTION_IDS = new Set([
  "goal-capsule",
  "product-contract",
  "product-requirements",
  "planning-contract",
  "implementation-units",
  "verification-contract",
  "definition-of-done",
  "appendix",
  "open-questions",
  "outstanding-questions",
]);
const PROTECTED_TAGS = new Set(["head", "script", "style"]);
const RAW_TEXT_TAGS = new Set(["pre", "code", "script", "style"]);

type Document = DefaultTreeAdapterTypes.Document;
type DocumentFragment = DefaultTreeAdapterTypes.DocumentFragment;
type Element = DefaultTreeAdapterTypes.Element;
type TextNode = DefaultTreeAdapterTypes.TextNode;
type ChildNode = DefaultTreeAdapterTypes.ChildNode;
type ParentNode = DefaultTreeAdapterTypes.ParentNode;

export type HtmlMutationOperation =
  | { type: "append-open-question"; itemHtml: string }
  | { type: "repair-heading-depth"; anchorId: string; fromLevel: 1 | 2 | 3 | 4 | 5 | 6; toLevel: 1 | 2 | 3 | 4 | 5 | 6 }
  | { type: "normalize-duplicate-inter-block-whitespace" }
  | { type: "replace-visible-text"; from: string; to: string; anchorId?: string };

export interface HtmlMutationSuccess {
  ok: true;
  html: string;
  fixesApplied: number;
}

export interface HtmlMutationRefusal {
  ok: false;
  reason: string;
  fixesApplied: 0;
}

export type HtmlMutationResult = HtmlMutationSuccess | HtmlMutationRefusal;

export interface HtmlMutationWriteSuccess {
  ok: true;
  fixesApplied: number;
  path: string;
}

export type HtmlMutationWriteResult = HtmlMutationWriteSuccess | HtmlMutationRefusal;

export interface HtmlMutationWriteOptions {
  rootDir?: string;
  validateWrittenHtml?: (html: string) => boolean;
}

interface ProtectedSnapshot {
  protectedMarkup: string[];
  ids: string[];
  dataAttrs: string[];
}

/*
FNXC:CompoundEngineering 2026-06-27-21:48:
FN-7149 requires CE HTML fixes to use a direct parse5 parse/mutate/serialize loop, not jsdom or markdown text edits. The helper refuses unless the source is parse5 round-trip stable, anchors resolve deterministically, protected regions are byte-preserved, and the write path can roll back after post-write validation.
*/

export function applyHtmlMutations(input: string, operations: readonly HtmlMutationOperation[]): HtmlMutationResult {
  let document = parseStableDocument(input);
  if (!document.ok) return document;

  const beforeVisibleText = getVisibleText(document.document);
  const protectedBefore = snapshotProtectedRegions(document.document);
  let expectedVisibleText = beforeVisibleText;
  let fixesApplied = 0;

  for (const operation of operations) {
    const mutation = applySingleOperation(document.document, operation);
    if (!mutation.ok) return mutation;
    if (mutation.applied) {
      fixesApplied += 1;
      expectedVisibleText = mutateExpectedVisibleText(expectedVisibleText, operation);
    }
  }

  const output = serialize(document.document);
  const reparsed = parseStableDocument(output);
  if (!reparsed.ok) return refusal(`post-mutation validation failed: ${reparsed.reason}`);

  const protectedAfter = snapshotProtectedRegions(reparsed.document);
  if (!sameJson(protectedBefore, protectedAfter)) return refusal("protected region changed during HTML mutation");
  if (getVisibleText(reparsed.document) !== expectedVisibleText) return refusal("visible text changed outside the intended mutation");

  return { ok: true, html: output, fixesApplied };
}

export function writeHtmlMutationsToFile(
  filePath: string,
  operations: readonly HtmlMutationOperation[],
  options: HtmlMutationWriteOptions = {},
): HtmlMutationWriteResult {
  let tempPath: string | undefined;
  try {
    const safePath = resolveSafeArtifactPath(filePath, options.rootDir);
    const original = readFileSync(safePath, "utf8");
    const result = applyHtmlMutations(original, operations);
    if (!result.ok) return result;
    if (result.fixesApplied === 0 || result.html === original) return { ok: true, fixesApplied: 0, path: safePath };

    tempPath = join(dirname(safePath), `.${basename(safePath)}.html-mutation-${randomUUID()}.tmp`);
    writeFileSync(tempPath, result.html, { encoding: "utf8", mode: 0o600 });
    renameSync(tempPath, safePath);
    tempPath = undefined;

    const written = readFileSync(safePath, "utf8");
    const postWrite = parseStableDocument(written);
    if (!postWrite.ok || written !== result.html || options.validateWrittenHtml?.(written) === false) {
      tempPath = join(dirname(safePath), `.${basename(safePath)}.html-mutation-rollback-${randomUUID()}.tmp`);
      writeFileSync(tempPath, original, { encoding: "utf8", mode: 0o600 });
      renameSync(tempPath, safePath);
      tempPath = undefined;
      return refusal("post-write validation failed; restored original HTML artifact");
    }

    return { ok: true, fixesApplied: result.fixesApplied, path: safePath };
  } catch (error) {
    if (tempPath) rmSync(tempPath, { force: true });
    return refusal(error instanceof Error ? error.message : "HTML mutation write failed");
  } finally {
    if (tempPath) rmSync(tempPath, { force: true });
  }
}

function parseStableDocument(input: string): { ok: true; document: Document } | HtmlMutationRefusal {
  const document = parse(input);
  const roundTrip = serialize(document);
  if (roundTrip !== input) return refusal("round-trip stability gate failed");
  return { ok: true, document };
}

function refusal(reason: string): HtmlMutationRefusal {
  return { ok: false, reason, fixesApplied: 0 };
}

function applySingleOperation(
  document: Document,
  operation: HtmlMutationOperation,
): { ok: true; applied: boolean } | HtmlMutationRefusal {
  switch (operation.type) {
    case "append-open-question":
      return appendOpenQuestion(document, operation.itemHtml);
    case "repair-heading-depth":
      return repairHeadingDepth(document, operation);
    case "normalize-duplicate-inter-block-whitespace":
      return normalizeDuplicateInterBlockWhitespace(document);
    case "replace-visible-text":
      return replaceVisibleText(document, operation);
    default:
      return refusal("unsupported HTML mutation operation");
  }
}

/**
 * FNXC:CompoundEngineering 2026-06-27-21:49:
 * Append-to-Open-Questions is portable to HTML only as a parsed single `<li>` fragment under an existing Open/Outstanding Questions list. The helper must not fabricate sections or inject script/style-capable fragments because FN-7147's report-only fallback is safer than guessing the CE renderer's structure.
 */
function appendOpenQuestion(document: Document, itemHtml: string): { ok: true; applied: boolean } | HtmlMutationRefusal {
  const anchor = resolveOpenQuestionsAnchor(document);
  if (!anchor.ok) return anchor;
  const list = resolveQuestionList(anchor.element);
  if (!list.ok) return list;
  const item = parseListItemFragment(itemHtml);
  if (!item.ok) return item;
  const itemMarkup = serializeOuter(item.element);
  if (list.element.childNodes.some((child) => isElement(child) && child.tagName === "li" && serializeOuter(child) === itemMarkup)) {
    return { ok: true, applied: false };
  }
  item.element.parentNode = list.element;
  list.element.childNodes.push(item.element);
  return { ok: true, applied: true };
}

function repairHeadingDepth(
  document: Document,
  operation: Extract<HtmlMutationOperation, { type: "repair-heading-depth" }>,
): { ok: true; applied: boolean } | HtmlMutationRefusal {
  if (!STABLE_SECTION_IDS.has(operation.anchorId)) return refusal("heading repair anchor is not in the stable CE section registry");
  const anchor = resolveUniqueElementById(document, operation.anchorId);
  if (!anchor.ok) return anchor;
  if (!isHeading(anchor.element)) return refusal("heading repair anchor does not resolve to a heading element");
  if (anchor.element.tagName === `h${operation.toLevel}`) return { ok: true, applied: false };
  if (anchor.element.tagName !== `h${operation.fromLevel}`) return refusal("heading repair source level does not match the anchored element");
  anchor.element.nodeName = `h${operation.toLevel}`;
  anchor.element.tagName = `h${operation.toLevel}`;
  return { ok: true, applied: true };
}

/**
 * FNXC:CompoundEngineering 2026-06-27-21:50:
 * Duplicate whitespace normalization is limited to adjacent inter-block text nodes outside raw-text elements. It never rewrites text inside prose, pre/code, script, or style, so rendered words and executable/style content stay byte-identical.
 */
function normalizeDuplicateInterBlockWhitespace(document: Document): { ok: true; applied: boolean } | HtmlMutationRefusal {
  let applied = false;
  walkParents(document, (parent) => {
    if (isElement(parent) && RAW_TEXT_TAGS.has(parent.tagName)) return;
    for (let index = parent.childNodes.length - 1; index > 0; index -= 1) {
      const current = parent.childNodes[index];
      const previous = parent.childNodes[index - 1];
      if (isWhitespaceText(current) && isWhitespaceText(previous)) {
        parent.childNodes.splice(index, 1);
        applied = true;
      }
    }
  });
  return { ok: true, applied };
}

/**
 * FNXC:CompoundEngineering 2026-06-27-21:51:
 * Typo repair is constrained to one exact visible text-node substring. Ambiguous matches, protected-region matches, and cross-node wording edits stay report-only because they cannot prove visible-prose equivalence without human judgment.
 */
function replaceVisibleText(
  document: Document,
  operation: Extract<HtmlMutationOperation, { type: "replace-visible-text" }>,
): { ok: true; applied: boolean } | HtmlMutationRefusal {
  if (!operation.from || operation.from === operation.to) return { ok: true, applied: false };
  const root = operation.anchorId ? resolveUniqueElementById(document, operation.anchorId) : { ok: true as const, element: document };
  if (!root.ok) return root;
  const matches: TextNode[] = [];
  walkNodes(root.element, (node, ancestors) => {
    if (!isText(node) || isInsideProtectedOrRawText(ancestors)) return;
    if (countOccurrences(node.value, operation.from) === 1) matches.push(node);
  });
  if (matches.length !== 1) return refusal("visible text replacement did not resolve to exactly one text node");
  matches[0].value = matches[0].value.replace(operation.from, operation.to);
  return { ok: true, applied: true };
}

function mutateExpectedVisibleText(text: string, operation: HtmlMutationOperation): string {
  if (operation.type === "append-open-question") return normalizeVisibleText(`${text} ${getVisibleText(parseFragment(operation.itemHtml))}`);
  if (operation.type === "replace-visible-text") return normalizeVisibleText(text.replace(operation.from, operation.to));
  return text;
}

function resolveOpenQuestionsAnchor(document: Document): { ok: true; element: Element } | HtmlMutationRefusal {
  const byId = uniqueElements(
    ["open-questions", "outstanding-questions"].flatMap((id) => findElements(document, (el) => getAttr(el, "id") === id)),
  );
  if (byId.length === 1) return { ok: true, element: byId[0] };
  if (byId.length > 1) return refusal("Open Questions anchor is ambiguous");

  const byHeading = uniqueElements(
    findElements(document, (el) => isHeading(el) && /^(open|outstanding) questions$/i.test(getVisibleText(el).trim())),
  );
  if (byHeading.length !== 1) return refusal(byHeading.length === 0 ? "Open Questions anchor not found" : "Open Questions anchor is ambiguous");
  return { ok: true, element: byHeading[0] };
}

function resolveQuestionList(anchor: Element): { ok: true; element: Element } | HtmlMutationRefusal {
  const candidates: Element[] = [];
  if (anchor.tagName === "section" || anchor.tagName === "article" || anchor.tagName === "div") {
    candidates.push(...findElements(anchor, (el) => el !== anchor && (el.tagName === "ul" || el.tagName === "ol")));
  } else if (isHeading(anchor) && anchor.parentNode && "childNodes" in anchor.parentNode) {
    const siblings = anchor.parentNode.childNodes;
    const start = siblings.indexOf(anchor);
    const anchorLevel = headingLevel(anchor);
    for (const sibling of siblings.slice(start + 1)) {
      if (isElement(sibling) && isHeading(sibling) && headingLevel(sibling) <= anchorLevel) break;
      if (isElement(sibling) && (sibling.tagName === "ul" || sibling.tagName === "ol")) candidates.push(sibling);
      if (isElement(sibling)) candidates.push(...findElements(sibling, (el) => el.tagName === "ul" || el.tagName === "ol"));
    }
  }
  const unique = uniqueElements(candidates);
  if (unique.length !== 1) return refusal(unique.length === 0 ? "Open Questions list not found" : "Open Questions list is ambiguous");
  return { ok: true, element: unique[0] };
}

function parseListItemFragment(itemHtml: string): { ok: true; element: Element } | HtmlMutationRefusal {
  const fragment = parseFragment(itemHtml);
  const elementChildren = fragment.childNodes.filter(isElement);
  if (elementChildren.length !== 1 || fragment.childNodes.some((node) => !isWhitespaceText(node) && !isElement(node))) {
    return refusal("Open Questions append requires exactly one list item fragment");
  }
  const [item] = elementChildren;
  if (item.tagName !== "li") return refusal("Open Questions append fragment must be a list item");
  if (findElements(item, (el) => el.tagName === "script" || el.tagName === "style").length > 0) {
    return refusal("Open Questions append fragment cannot contain script or style elements");
  }
  return { ok: true, element: item };
}

function resolveUniqueElementById(document: Document, id: string): { ok: true; element: Element } | HtmlMutationRefusal {
  const matches = findElements(document, (el) => getAttr(el, "id") === id);
  if (matches.length !== 1) return refusal(matches.length === 0 ? `anchor id not found: ${id}` : `anchor id is ambiguous: ${id}`);
  return { ok: true, element: matches[0] };
}

function resolveSafeArtifactPath(filePath: string, rootDir?: string): string {
  const stat = lstatSync(filePath);
  if (stat.isSymbolicLink()) throw new Error("Symlink HTML artifacts are not allowed");
  if (!stat.isFile()) throw new Error("HTML mutation target must be a file");
  if (stat.size > MAX_ARTIFACT_BYTES) throw new Error("HTML artifact exceeds mutation size limit");
  const realFile = realpathSync(filePath);
  if (rootDir) {
    const realRoot = realpathSync(rootDir);
    const rel = relative(realRoot, realFile);
    if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("HTML mutation target escapes the project root");
  }
  return realFile;
}

function snapshotProtectedRegions(root: ParentNode): ProtectedSnapshot {
  const protectedMarkup: string[] = [];
  const ids: string[] = [];
  const dataAttrs: string[] = [];
  walkNodes(root, (node) => {
    if (!isElement(node)) return;
    if (PROTECTED_TAGS.has(node.tagName)) protectedMarkup.push(serializeOuter(node));
    const id = getAttr(node, "id");
    if (id) ids.push(id);
    for (const attr of node.attrs) {
      if (attr.name.startsWith("data-")) dataAttrs.push(`${node.tagName}[${attr.name}=${attr.value}]`);
    }
  });
  return { protectedMarkup, ids, dataAttrs };
}

function getVisibleText(root: ParentNode): string {
  let text = "";
  walkNodes(root, (node, ancestors) => {
    if (isText(node) && !isInsideProtectedOrRawText(ancestors)) text += node.value;
  });
  return normalizeVisibleText(text);
}

function normalizeVisibleText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function isInsideProtected(ancestors: readonly ParentNode[]): boolean {
  return ancestors.some((ancestor) => isElement(ancestor) && PROTECTED_TAGS.has(ancestor.tagName));
}

function isInsideProtectedOrRawText(ancestors: readonly ParentNode[]): boolean {
  return ancestors.some((ancestor) => isElement(ancestor) && (PROTECTED_TAGS.has(ancestor.tagName) || RAW_TEXT_TAGS.has(ancestor.tagName)));
}

function walkParents(node: ParentNode, visit: (node: ParentNode) => void): void {
  visit(node);
  for (const child of node.childNodes) {
    if (isParent(child)) walkParents(child, visit);
  }
}

function walkNodes(node: ParentNode | ChildNode, visit: (node: ParentNode | ChildNode, ancestors: ParentNode[]) => void, ancestors: ParentNode[] = []): void {
  visit(node, ancestors);
  if (!isParentLike(node)) return;
  for (const child of node.childNodes) {
    walkNodes(child, visit, [...ancestors, node]);
  }
}

function findElements(root: ParentNode, predicate: (element: Element) => boolean): Element[] {
  const matches: Element[] = [];
  walkNodes(root, (node) => {
    if (isElement(node) && predicate(node)) matches.push(node);
  });
  return matches;
}

function uniqueElements(elements: Element[]): Element[] {
  return [...new Set(elements)];
}

function isParent(node: ChildNode): node is Element {
  return "childNodes" in node;
}

function isParentLike(node: ParentNode | ChildNode): node is ParentNode {
  return "childNodes" in node;
}

function isElement(node: ParentNode | ChildNode): node is Element {
  return "tagName" in node;
}

function isText(node: ParentNode | ChildNode): node is TextNode {
  return node.nodeName === "#text";
}

function isWhitespaceText(node: ChildNode): node is TextNode {
  return isText(node) && /^\s*$/.test(node.value);
}

function isHeading(element: Element): boolean {
  return /^h[1-6]$/.test(element.tagName);
}

function headingLevel(element: Element): number {
  return Number(element.tagName.slice(1));
}

function getAttr(element: Element, name: string): string | undefined {
  return element.attrs.find((attr) => attr.name === name)?.value;
}

function countOccurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
