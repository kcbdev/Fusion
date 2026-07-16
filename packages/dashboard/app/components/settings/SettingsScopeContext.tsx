/**
 * SettingsScopeContext — the ONE scope signal per settings screen.
 *
 * FNXC:SettingsScope 2026-07-16-08:10:
 * Scope moved from a badge stamped on every row to a single indicator at the
 * top of each screen (operator request: the per-row badges were present on some
 * rows and absent on others — bespoke widget rows never carried one — which read
 * as broken). The screen indicator states the section's default authority level
 * once; `SettingsFieldRow` now shows a per-row badge ONLY for a row whose scope
 * DIFFERS from the screen (the Appearance exception: a global theme screen that
 * also holds project-scoped task-popup toggles). Single-scope screens therefore
 * show exactly one badge; genuinely mixed screens stay honest.
 *
 * This supersedes the removed section-level "scope banner" (dropped in the
 * unify-styling pass because it asserted one scope for a section that mixed
 * them): the difference is that the row-level exception badge survives, so the
 * indicator never has to claim a single scope for a mixed screen.
 */
import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Globe, Folder } from "lucide-react";
import type { SettingsScope } from "./SettingsFieldRow";
import "./SettingsScopeContext.css";

/** The active screen's default scope, or undefined for storage-less/no-scope screens. */
const SettingsScreenScopeContext = createContext<SettingsScope | undefined>(undefined);

export function SettingsScopeProvider({ scope, children }: { scope: SettingsScope | undefined; children: ReactNode }) {
  return <SettingsScreenScopeContext.Provider value={scope}>{children}</SettingsScreenScopeContext.Provider>;
}

/** Read the current screen's default scope (undefined when none applies). */
export function useSettingsScreenScope(): SettingsScope | undefined {
  return useContext(SettingsScreenScopeContext);
}

/**
 * The per-screen scope indicator rendered above a section's fields.
 *
 * FNXC:SettingsScope 2026-07-16-08:10:
 * Renders nothing when the screen has no settings scope (storage-less CRUD
 * screens such as Authentication resolve to a scope via the caller; a truly
 * scopeless screen shows no indicator rather than a misleading one).
 */
export function SettingsScopeIndicator({ scope }: { scope: SettingsScope | undefined }) {
  const { t } = useTranslation("app");
  if (!scope) return null;
  const isGlobal = scope === "global";
  const Icon = isGlobal ? Globe : Folder;
  const label = isGlobal ? t("settings.scope.global", "Global") : t("settings.scope.project", "Project");
  const title = isGlobal
    ? t("settings.nav.tooltip.global", "Shared across all projects")
    : t("settings.nav.tooltip.project", "Specific to this project");
  return (
    <div
      className={`settings-scope-indicator settings-scope-indicator--${scope}`}
      data-testid="settings-scope-indicator"
      data-scope={scope}
      title={title}
    >
      <Icon size={13} aria-hidden />
      <span>{label}</span>
    </div>
  );
}
