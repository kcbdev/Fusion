import { describe, expect, it } from "vitest";
import { loadAllAppCss } from "../../test/cssFixture";

describe("FileBrowser.css token contract", () => {
  it("does not use deprecated --radius alias token", async () => {
    const css = await loadAllAppCss();
    const fileBrowserSection = css.match(/\/\* FileBrowser\.css \*\/[\s\S]*?(?=\/\* [^\n]*\.css \*\/|$)/)?.[0] ?? "";
    expect(fileBrowserSection).toBeTruthy();
    expect(fileBrowserSection).not.toMatch(/var\(--radius\)/);
  });
});
