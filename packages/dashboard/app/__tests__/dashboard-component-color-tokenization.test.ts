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
];

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

  it("keeps CustomModelDropdown free of raw rgba()", () => {
    const source = readFileSync(resolve(root, "CustomModelDropdown.css"), "utf8");
    expect(source).not.toMatch(/rgba\(/);
  });
});
