import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../components");

const auditedCompliant = ["ChatView.css", "MobileNavBar.css", "ListView.css", "WorkflowResultsTab.css"];
const cleanedFiles = [
  "AgentReflectionsTab.css",
  "BackgroundTasksIndicator.css",
  "CliBinaryInstallBanner.css",
  "CliBinaryPanel.css",
  "FileMentionPopup.css",
  "GitHubImportModal.css",
  "InlineCreateCard.css",
  "LanguageSelector.css",
  "PullRequestView.css",
  "ScriptsModal.css",
  "SettingsFieldRow.css",
  "SettingsSyncLog.css",
  "WorkflowFieldsPanel.css",
  "WorkflowNodeEditor.css",
  "WorkflowSettingsPanel.css",
  "WorkspaceSelector.css",
];

const bareHexCleanedFiles = ["ScriptsModal.css", "SettingsSyncLog.css"];
const hexLiteralPattern = /#[0-9a-fA-F]{3,8}\b/;

function resolveComponentCss(file: string): string {
  const directPath = resolve(root, file);
  if (existsSync(directPath)) {
    return directPath;
  }

  return resolve(root, "settings", file);
}

function stripVarCalls(line: string): string {
  return line.replace(/var\([^)]*\)/g, "");
}

describe("dashboard component color tokenization", () => {
  it("keeps audited compliant files free of raw rgba()", () => {
    for (const file of auditedCompliant) {
      const source = readFileSync(resolve(root, file), "utf8");
      expect(source).not.toMatch(/rgba\(/);
    }
  });

  it("keeps cleaned files free of raw rgba()", () => {
    for (const file of cleanedFiles) {
      const source = readFileSync(resolveComponentCss(file), "utf8");
      expect(source).not.toMatch(/rgba\(/);
    }
  });

  it("keeps cleaned files free of bare hex outside var() fallbacks", () => {
    for (const file of bareHexCleanedFiles) {
      const source = readFileSync(resolve(root, file), "utf8");
      const linesWithBareHex = source
        .split(/\r?\n/)
        .map((line, index) => ({ index: index + 1, strippedLine: stripVarCalls(line) }))
        .filter(({ strippedLine }) => hexLiteralPattern.test(strippedLine));

      expect(linesWithBareHex, `${file} has bare hex colors outside var() fallbacks`).toEqual([]);
    }
  });

  it("keeps CustomModelDropdown free of raw rgba()", () => {
    const source = readFileSync(resolve(root, "CustomModelDropdown.css"), "utf8");
    expect(source).not.toMatch(/rgba\(/);
  });
});
