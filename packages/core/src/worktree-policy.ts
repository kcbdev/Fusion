import { resolveUiMode, type UiModeSettingsSource } from "./ui-mode.js";

/** Global-scope inputs the worktree-enabled resolver reads. */
export interface WorktreePolicyGlobalSettings extends UiModeSettingsSource {
  /** The stored worktree-isolation preference (advanced-mode disable toggle). */
  worktreeIsolationEnabled?: boolean;
}

/** Project-scope override inputs the worktree-enabled resolver reads. */
export interface WorktreePolicyProjectSettings {
  /** Project-level override of the stored worktree-isolation preference. */
  worktreeIsolationEnabled?: boolean;
}

export interface ResolveWorktreeEnabledInput {
  globalSettings: WorktreePolicyGlobalSettings | undefined;
  projectSettings?: WorktreePolicyProjectSettings | undefined;
}

/**
 * The single, central resolver for "should this task execute in an isolated
 * per-task worktree?" (company-model plan U11, R23). Every worktree-enabled
 * read across the engine — executor, project-manager, engine-manager, runtime,
 * scheduler, and the shared `acquireTaskWorktree` funnel they call — MUST go
 * through here rather than reading the stored setting directly. That keeps the
 * simple-mode force-on impossible to bypass at any single site.
 *
 * Resolution order:
 *  1. **Simple mode forces isolation ON** — whenever `uiMode` resolves to
 *     `"simple"` (the default), this returns `true` regardless of any stored
 *     `worktreeIsolationEnabled` value at either scope. Advanced mode is the
 *     documented opt-out: switch the user-level `uiMode` to `"advanced"` to let
 *     the stored disable toggle take effect.
 *  2. **Otherwise honor the stored preference**, project value taking precedence
 *     over global (matching the existing precedence used by other dual-scope
 *     toggles such as `isMergeRequestContractShadowEnabled`).
 *  3. **Default enabled** — when nothing is stored at either scope, worktree
 *     isolation is on. Fusion has always used worktrees; the disable path is the
 *     explicit, advanced-only opt-out.
 *
 * Override coverage (decided explicitly per the U11 brief): the force-on covers
 * the per-task worktree-isolation toggle only — the boolean read here. It does
 * NOT touch orthogonal worktree *mechanics* (`worktreeNaming`,
 * `recycleWorktrees`, `worktrunk`, `worktreesDir`, `mergeIntegrationWorktree`),
 * which continue to apply on top of an enabled worktree. `uiMode` is the
 * `experimentalFeatures.companyModel`-independent gate: the force-on applies in
 * both flag states.
 */
export function resolveWorktreeEnabled(input: ResolveWorktreeEnabledInput): boolean {
  if (resolveUiMode(input.globalSettings) === "simple") {
    return true;
  }
  const projectValue = input.projectSettings?.worktreeIsolationEnabled;
  if (typeof projectValue === "boolean") return projectValue;
  const globalValue = input.globalSettings?.worktreeIsolationEnabled;
  if (typeof globalValue === "boolean") return globalValue;
  return true;
}

/**
 * Does simple mode force worktree isolation on against the user's stored
 * intent? True only when the resolver returns enabled AND the stored preference
 * (project precedence, else global) is an explicit `false`. Callers use this to
 * fire the one-time "simple mode forces worktrees on" notice (R23) — silent
 * force-on is disallowed.
 */
export function isWorktreeForcedOnBySimpleMode(input: ResolveWorktreeEnabledInput): boolean {
  if (resolveUiMode(input.globalSettings) !== "simple") return false;
  const projectValue = input.projectSettings?.worktreeIsolationEnabled;
  if (typeof projectValue === "boolean") return projectValue === false;
  return input.globalSettings?.worktreeIsolationEnabled === false;
}
