import { describe, expect, it } from "vitest";
import { loadAllAppCss } from "../test/cssFixture";

describe("QuickChat session dropdown CSS", () => {
  it("defines themed dropdown selectors using tokens", async () => {
    const css = await loadAllAppCss();

    const triggerBlock = css.match(/\.quick-chat-session-trigger\s*\{[^}]*\}/)?.[0] ?? "";
    const dropdownBlock = css.match(/\.quick-chat-session-dropdown\s*\{[^}]*\}/)?.[0] ?? "";

    expect(triggerBlock).toContain(".quick-chat-session-trigger");
    expect(dropdownBlock).toContain(".quick-chat-session-dropdown");

    const combined = `${triggerBlock}\n${dropdownBlock}`;
    expect(combined).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(combined).not.toMatch(/rgba?\(/);
    expect(combined).not.toMatch(/(?<![\w-])(?:[1-9]\d*|\d+\.\d+)px\b/);
  });
});
