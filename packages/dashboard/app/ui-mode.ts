/**
 * Simple/advanced UI-mode gating predicate (U11, R14/R15/R23).
 *
 * A single shared authority for "is this surface advanced-only?" consumed by the
 * navigation (Header), the deep-link redirect (App), and the settings sections
 * (SettingsModal). The gated set is enumerated explicitly so an invariant test
 * can pin it — adding a surface to the gated set without updating the test (and
 * vice-versa) turns the build red, guarding against silent drift as new surfaces
 * register across the app.
 *
 * Gating hides UI only; routes and data stay live (R15). The mode itself is a
 * user-level Global Setting resolved through `resolveUiMode` in @fusion/core.
 */

/**
 * The explicit, pinned list of advanced-only surface ids. Each id is either a
 * built-in `TaskView` value, a settings `SectionId`, or a synthetic id for a
 * surface that has no standalone route (panels embedded in other views).
 *
 * Per the plan, the gated set is:
 *  - missions view
 *  - workflow graph editor (the node/graph editor surface)
 *  - traits panel
 *  - custom fields panel
 *  - per-task agent/model controls
 *  - branch-group card management
 *  - plugin development views
 *
 * Plus the settings sections that expose advanced-only machinery (worktrees,
 * agent permissions, node routing, experimental features, prompts) — these reuse
 * the same predicate so simple mode hides them too.
 *
 * NOTE: keep this list and `packages/dashboard/app/__tests__/ui-mode-gating.test.tsx`
 * EXPECTED_GATED_SURFACES in lockstep.
 */
export const GATED_SURFACES = [
  // ── Top-level views (TaskView ids) ──────────────────────────────────────────
  "missions",
  "graph", // workflow graph editor view
  // ── Embedded panels / controls (synthetic ids) ─────────────────────────────
  "traits-panel",
  "custom-fields-panel",
  "per-task-agent-model",
  "branch-group-management",
  "plugin-development",
  // ── Settings sections (SectionId ids) ──────────────────────────────────────
  "worktrees",
  "agent-permissions",
  "node-routing",
  "experimental",
  "prompts",
] as const;

export type GatedSurfaceId = (typeof GATED_SURFACES)[number];

const GATED_SURFACE_SET: ReadonlySet<string> = new Set(GATED_SURFACES);

/**
 * True when `surfaceId` is gated to advanced mode.
 *
 * Plugin-contributed views are NOT categorically gated: pass `pluginSimpleMode`
 * (the view manifest's optional `simpleMode` declaration) when `surfaceId` is a
 * plugin view. A plugin view that declares `simpleMode: true` is allowed in
 * simple mode; an undeclared plugin view (`undefined`) defaults to advanced-only.
 * Non-plugin surfaces ignore `pluginSimpleMode` and consult the static set.
 */
export function isAdvancedSurface(
  surfaceId: string,
  pluginSimpleMode?: boolean,
): boolean {
  if (isPluginSurfaceId(surfaceId)) {
    // Declared simple-mode-compatible → allowed in simple. Undeclared → advanced-only.
    return pluginSimpleMode !== true;
  }
  return GATED_SURFACE_SET.has(surfaceId);
}

/** True when `surfaceId` is a plugin-contributed view id (`plugin:<id>:<view>`). */
export function isPluginSurfaceId(surfaceId: string): boolean {
  return surfaceId.startsWith("plugin:");
}

/**
 * Whether a surface should be VISIBLE given the current mode. Convenience wrapper
 * around `isAdvancedSurface`: advanced mode shows everything; simple mode hides
 * gated surfaces.
 */
export function isSurfaceVisibleInMode(
  surfaceId: string,
  uiMode: "simple" | "advanced",
  pluginSimpleMode?: boolean,
): boolean {
  if (uiMode === "advanced") return true;
  return !isAdvancedSurface(surfaceId, pluginSimpleMode);
}
