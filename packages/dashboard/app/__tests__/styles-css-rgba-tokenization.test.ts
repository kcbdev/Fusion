import { describe, expect, it } from "vitest";
import { loadStylesCss } from "../test/cssFixture";

interface SelectorExpectation {
  selector: string;
  expectedColorMix: string;
}

const convertedSelectors: SelectorExpectation[] = [
  {
    selector: ".modal-overlay",
    expectedColorMix: "color-mix(in srgb, var(--text) 60%, transparent)",
  },
  {
    selector: ".modal-header",
    expectedColorMix: "color-mix(in srgb, var(--text) 10%, transparent)",
  },
  {
    selector: ".modal-actions",
    expectedColorMix: "color-mix(in srgb, var(--text) 5%, transparent)",
  },
  {
    selector: ".settings-sidebar",
    expectedColorMix: "color-mix(in srgb, var(--text) 10%, transparent)",
  },
  {
    selector: ".step-progress-segment[data-tooltip]:hover::after",
    expectedColorMix: "color-mix(in srgb, var(--text) 20%, transparent)",
  },
  {
    selector: ".dep-dropdown-item.selected",
    expectedColorMix: "color-mix(in srgb, var(--todo) 15%, transparent)",
  },
  {
    selector: ".refine-menu",
    expectedColorMix: "color-mix(in srgb, var(--text) 15%, transparent)",
  },
];

function braceDelta(line: string): number {
  return (line.match(/\{/g) ?? []).length - (line.match(/}/g) ?? []).length;
}

function isTokenDefinitionBlockStart(line: string): boolean {
  return /^\s*:root(?:\[data-theme=[^\]]+\])?\s*\{/.test(line);
}

function nonTokenRgbaLines(css: string): string[] {
  const violations: string[] = [];
  const lines = css.split(/\r?\n/);
  let tokenBlockDepth = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const entersTokenBlock = tokenBlockDepth === 0 && isTokenDefinitionBlockStart(line);
    if (entersTokenBlock) {
      tokenBlockDepth = braceDelta(line);
    }

    const insideTokenBlock = tokenBlockDepth > 0 || entersTokenBlock;
    if (!insideTokenBlock && line.includes("rgba(")) {
      violations.push(`${index + 1}:${line.trim()}`);
    }

    if (!entersTokenBlock && tokenBlockDepth > 0) {
      tokenBlockDepth += braceDelta(line);
    }
  }

  return violations;
}

function extractSelectorBlocks(css: string, selector: string): string[] {
  const blocks: string[] = [];
  let searchStart = 0;

  while (searchStart < css.length) {
    const selectorStart = css.indexOf(`${selector} {`, searchStart);
    if (selectorStart === -1) break;

    const blockStart = css.indexOf("{", selectorStart);
    let depth = 0;
    for (let index = blockStart; index < css.length; index += 1) {
      if (css[index] === "{") {
        depth += 1;
      } else if (css[index] === "}") {
        depth -= 1;
        if (depth === 0) {
          blocks.push(css.slice(selectorStart, index + 1));
          searchStart = index + 1;
          break;
        }
      }
    }

    if (blockStart === -1 || searchStart <= selectorStart) {
      throw new Error(`Unterminated block for selector ${selector}`);
    }
  }

  return blocks;
}

describe("styles.css rgba tokenization", () => {
  it("does not use raw rgba() outside :root token definition blocks", () => {
    expect(nonTokenRgbaLines(loadStylesCss())).toEqual([]);
  });

  it("keeps converted selectors on tokenized color-mix() values", () => {
    const css = loadStylesCss();

    for (const { selector, expectedColorMix } of convertedSelectors) {
      const blocks = extractSelectorBlocks(css, selector);
      expect(blocks, `Missing selector ${selector}`).not.toHaveLength(0);

      const matchingBlock = blocks.find((block) => block.includes(expectedColorMix));
      expect(matchingBlock, `Missing expected tokenized value for ${selector}`).toBeDefined();
      expect(matchingBlock).toContain("color-mix(in srgb, var(--");
      expect(matchingBlock).not.toContain("rgba(");
    }
  });
});
