import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../components");

const auditedCompliant = ["ChatView.css", "MobileNavBar.css", "ListView.css", "WorkflowResultsTab.css"];
const cleanedFiles = [
  "ScriptsModal.css",
  "InlineCreateCard.css",
  "FileMentionPopup.css",
  "BackgroundTasksIndicator.css",
  "CliBinaryPanel.css",
  "CliBinaryInstallBanner.css",
  "GitHubImportModal.css",
  "WorkspaceSelector.css",
  "AgentReflectionsTab.css",
  "SettingsSyncLog.css",
];

const bareHexCleanedFiles = ["ScriptsModal.css", "SettingsSyncLog.css"];
const hexLiteralPattern = /#[0-9a-fA-F]{3,8}\b/;

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
      const source = readFileSync(resolve(root, file), "utf8");
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
