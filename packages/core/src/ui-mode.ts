import { UI_MODES, type UiMode } from "./types.js";

/** Settings source carrying the user-level `uiMode` preference. */
export interface UiModeSettingsSource {
  uiMode?: UiMode;
}

/**
 * Resolve the effective UI complexity mode (company-model plan U11, R14).
 *
 * `uiMode` is a user-level Global Setting. When unset or holding an unrecognized
 * value, it defaults to `"simple"` — the safe, gated default. This is the single
 * accessor every surface (dashboard, TUI, engine) should call so the literal
 * mode values and the default live in exactly one place.
 *
 * Distinct from and unrelated to `experimentalFeatures.companyModel`
 * ({@link isCompanyModelEnabled}): `uiMode` governs UI gating + worktree
 * force-on only and is never flag-gated.
 */
export function resolveUiMode(settings: UiModeSettingsSource | undefined): UiMode {
  const stored = settings?.uiMode;
  return (UI_MODES as readonly string[]).includes(stored as string) ? (stored as UiMode) : "simple";
}
