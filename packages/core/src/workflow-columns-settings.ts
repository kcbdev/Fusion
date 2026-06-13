import { isExperimentalFeatureEnabled } from "./experimental-features.js";
import type { Settings } from "./types.js";

/**
 * The `experimentalFeatures.workflowColumns` flag (KTD-8). OFF: the legacy
 * enum/`VALID_TRANSITIONS` path runs untouched. ON: `moveTaskInternal` resolves
 * each task's workflow column graph + trait guards. The workflow-resolved path
 * is now default-on while the explicit OFF override remains available.
 *
 * Mirrors `isSandboxExperimentalEnabled` / `isEvalsViewEnabled` — a thin,
 * named accessor over the shared experimental-features map so the literal flag
 * key lives in exactly one place.
 */
export function isWorkflowColumnsEnabled(
  settings: Pick<Settings, "experimentalFeatures"> | undefined,
): boolean {
  return isExperimentalFeatureEnabled(settings, "workflowColumns");
}
