import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadAllAppCssBaseOnly } from "../../test/cssFixture";

const COMPONENTS_DIR = resolve(__dirname, "..");

function readComponentCss(fileName: string): string {
  return readFileSync(join(COMPONENTS_DIR, fileName), "utf-8");
}

function extractMediaBlocks(css: string, query: string): string[] {
  const blocks: string[] = [];
  let cursor = 0;
  while (cursor < css.length) {
    const start = css.indexOf(`@media ${query}`, cursor);
    if (start < 0) break;
    const open = css.indexOf("{", start);
    let depth = 1;
    let i = open + 1;
    while (i < css.length && depth > 0) {
      if (css[i] === "{") depth += 1;
      else if (css[i] === "}") depth -= 1;
      i += 1;
    }
    blocks.push(css.slice(open + 1, i - 1));
    cursor = i;
  }
  return blocks;
}

function findRule(blocks: string[], selector: RegExp): string {
  const rule = blocks.map((block) => block.match(selector)?.[0] ?? "").find(Boolean) ?? "";
  expect(rule).toBeTruthy();
  return rule;
}

describe("WorkflowNodeEditor mobile CSS contract", () => {
  it("FN-5992 preserves desktop editor min-width while adding full-screen mobile overrides", () => {
    const baseCss = loadAllAppCssBaseOnly();
    const editorCss = readComponentCss("WorkflowNodeEditor.css");
    const mobileBlocks = extractMediaBlocks(editorCss, "(max-width: 768px)");

    expect(baseCss).toMatch(/\.wf-editor-modal\s*\{[^}]*min-width\s*:\s*640px\s*;/);

    const editorModalRule = findRule(mobileBlocks, /\.wf-editor-modal,\s*\.wf-create-modal\s*\{[^}]*\}/);
    expect(editorModalRule).toMatch(/width\s*:\s*100vw\s*;/);
    expect(editorModalRule).toMatch(/height\s*:\s*100dvh\s*;/);
    expect(editorModalRule).toMatch(/border-radius\s*:\s*0\s*;/);
    expect(editorModalRule).toMatch(/resize\s*:\s*none\s*;/);

    const sidebarRule = findRule(mobileBlocks, /\.wf-editor-sidebar\s*\{[^}]*\}/);
    expect(sidebarRule).toMatch(/width\s*:\s*100%\s*;/);

    const inspectorRule = findRule(mobileBlocks, /\.wf-editor-inspector\s*\{[^}]*\}/);
    expect(inspectorRule).toMatch(/width\s*:\s*100%\s*;/);

    const settingsRule = findRule(mobileBlocks, /\.wf-editor-body \.wf-settings-panel\s*\{[^}]*\}/);
    expect(settingsRule).toMatch(/width\s*:\s*100%\s*;/);
    expect(settingsRule).toMatch(/min-width\s*:\s*0\s*;/);

    const canvasWrapRule = findRule(mobileBlocks, /\.wf-editor-canvas-wrap\s*\{[^}]*\}/);
    expect(canvasWrapRule).toMatch(/min-height\s*:\s*40vh\s*;/);
  });

  it("FN-5992 covers create dialog and AI panel mobile overlays", () => {
    const editorCss = readComponentCss("WorkflowNodeEditor.css");
    const mobileBlocks = extractMediaBlocks(editorCss, "(max-width: 768px)");

    const overlayRule = findRule(mobileBlocks, /\.modal-overlay:has\(\.wf-editor-modal\),\s*\.modal-overlay:has\(\.wf-create-modal\)\s*\{[^}]*\}/);
    expect(overlayRule).toMatch(/padding-top\s*:\s*0\s*;/);
    expect(overlayRule).toMatch(/align-items\s*:\s*stretch\s*;/);

    const templateListRule = findRule(mobileBlocks, /\.wf-template-list\s*\{[^}]*\}/);
    expect(templateListRule).toMatch(/max-height\s*:\s*40vh\s*;/);

    const aiPanelRule = findRule(mobileBlocks, /\.wf-ai-panel\s*\{[^}]*\}/);
    expect(aiPanelRule).toMatch(/position\s*:\s*fixed\s*;/);
    expect(aiPanelRule).toMatch(/inset\s*:\s*var\(--space-sm\)\s*;/);
    expect(aiPanelRule).toMatch(/z-index\s*:\s*30\s*;/);
  });

  it("FN-5992 adds standalone mobile workflow panel overrides", () => {
    const settingsCss = readComponentCss("WorkflowSettingsPanel.css");
    const fieldsCss = readComponentCss("WorkflowFieldsPanel.css");
    const selectorCss = readComponentCss("WorkflowSelector.css");

    const settingsMobile = extractMediaBlocks(settingsCss, "(max-width: 768px)");
    const settingsRule = findRule(settingsMobile, /\.wf-settings-panel\s*\{[^}]*\}/);
    expect(settingsRule).toMatch(/width\s*:\s*100%\s*;/);
    expect(settingsRule).toMatch(/min-width\s*:\s*0\s*;/);

    const fieldsMobile = extractMediaBlocks(fieldsCss, "(max-width: 768px)");
    const fieldsRule = findRule(fieldsMobile, /\.wf-fields-panel\s*\{[^}]*\}/);
    expect(fieldsRule).toMatch(/width\s*:\s*100%\s*;/);
    expect(fieldsRule).toMatch(/min-width\s*:\s*0\s*;/);

    const selectorMobile = extractMediaBlocks(selectorCss, "(max-width: 768px)");
    const selectorRule = findRule(selectorMobile, /\.workflow-selector\s*\{[^}]*\}/);
    expect(selectorRule).toMatch(/flex-direction\s*:\s*column\s*;/);

    const manageRule = findRule(selectorMobile, /\.workflow-selector select,\s*\.workflow-selector-manage\s*\{[^}]*\}/);
    expect(manageRule).toMatch(/width\s*:\s*100%\s*;/);
  });
});
