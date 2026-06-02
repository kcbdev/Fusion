import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

function extractBlock(content: string, pattern: RegExp): string {
  const match = content.match(pattern);
  expect(match?.index).toBeDefined();

  const start = match!.index! + match![0].length;
  let index = start;
  let depth = 1;

  while (index < content.length && depth > 0) {
    if (content[index] === "{") depth += 1;
    if (content[index] === "}") depth -= 1;
    index += 1;
  }

  expect(depth).toBe(0);
  return content.slice(match!.index!, index);
}

describe("global spinner animation utility", () => {
  const css = readFileSync(resolve(__dirname, "../styles.css"), "utf8");

  it("keeps top-level spin keyframes rotating to 360deg", () => {
    const topLevelSpinBlock = extractBlock(css, /@keyframes\s+spin\s*\{/);

    expect(topLevelSpinBlock).toContain("transform: rotate(360deg);");
    expect(css.indexOf("@keyframes spin")).toBeLessThan(css.indexOf(":root {\n  --bg:"));
  });

  it("keeps the shared animate-spin and spin utilities running infinitely", () => {
    const animateSpinBlock = css.match(/\.animate-spin\s*\{[\s\S]*?\}/)?.[0] ?? "";
    const spinBlock = css.match(/\.spin\s*\{[\s\S]*?\}/)?.[0] ?? "";

    expect(animateSpinBlock).toContain("animation: spin 1s linear infinite;");
    expect(spinBlock).toContain("animation: spin 1s linear infinite;");
  });

  it("anchors SVG spinners around their own center", () => {
    const animateSpinBlock = css.match(/\.animate-spin\s*\{[\s\S]*?\}/)?.[0] ?? "";
    const spinBlock = css.match(/\.spin\s*\{[\s\S]*?\}/)?.[0] ?? "";
    const svgSpinnerBlock = css.match(/svg\.animate-spin,\s*svg\.spin\s*\{[\s\S]*?\}/)?.[0] ?? "";

    expect(animateSpinBlock).toContain("transform-origin: center;");
    expect(spinBlock).toContain("transform-origin: center;");
    expect(svgSpinnerBlock).toContain("transform-box: fill-box;");
  });
});
