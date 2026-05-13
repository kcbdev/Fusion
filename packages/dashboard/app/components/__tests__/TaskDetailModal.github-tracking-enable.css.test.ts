import { describe, expect, it } from "vitest";
import { loadAllAppCss, loadAllAppCssBaseOnly } from "../../test/cssFixture";

describe("TaskDetailModal GitHub tracking enable button CSS contract", () => {
  it("FN-4163 keeps the desktop Enable button compact while preserving the mobile touch target", async () => {
    const baseCss = await loadAllAppCssBaseOnly();
    const css = await loadAllAppCss();

    expect(baseCss).toMatch(
      /\.detail-github-tracking-enable\s*\{[^}]*min-width\s*:\s*0\s*;[^}]*min-height\s*:\s*0\s*;/,
    );
    expect(css).toMatch(
      /@media\s*\(max-width:\s*768px\)\s*\{[\s\S]*?\.detail-github-tracking-section\s+\.detail-github-tracking-enable\s*\{[^}]*min-width\s*:\s*44px\s*;[^}]*min-height\s*:\s*44px\s*;/,
    );
  });
});
