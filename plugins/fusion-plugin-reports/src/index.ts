import type { PluginContext } from "@fusion/core";
import { definePlugin } from "@fusion/plugin-sdk";
import { runReviewPanel } from "./review-panel.js";
import type { CombinedReview, ReviewPanelMember, RunReviewPanelInput } from "./review-types.js";
import { settingsSchema } from "./settings.js";

const plugin = definePlugin({
  manifest: {
    id: "fusion-plugin-reports",
    name: "Reports",
    version: "0.1.0",
    description: "Generates beautiful HTML system-activity reports with multi-agent review.",
    author: "Fusion Team",
    fusionVersion: ">=0.1.0",
    settingsSchema,
  },
  state: "installed",
  hooks: {},
});

export interface RunGeneratedReportReviewInput {
  reportDraft: string;
  reportMetadata: RunReviewPanelInput["reportMetadata"];
  panel: ReviewPanelMember[];
  cwd: string;
}

export async function runGeneratedReportReview(input: RunGeneratedReportReviewInput, ctx: PluginContext): Promise<CombinedReview> {
  return runReviewPanel({
    reportDraft: input.reportDraft,
    reportMetadata: input.reportMetadata,
    panel: input.panel,
    cwd: input.cwd,
  }, ctx);
}

export default plugin;

export * from "./settings.js";
export * from "./review-types.js";
export * from "./review-panel.js";
