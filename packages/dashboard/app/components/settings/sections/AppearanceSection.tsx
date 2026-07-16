import { useTranslation } from "react-i18next";
import type { ThemeMode, ColorTheme } from "@fusion/core";
import { ThemeSelector } from "../../ThemeSelector";
import { LanguageSelector } from "../../LanguageSelector";
import type { SectionBaseProps } from "./context";
export interface AppearanceSectionProps extends SectionBaseProps {
    themeMode: ThemeMode;
    colorTheme: ColorTheme;
    dashboardFontScalePct: number;
    shadcnCustomColors?: Record<string, string>;
    resolvedThemeMode?: "dark" | "light";
    onThemeModeChange?: (mode: ThemeMode) => void;
    onColorThemeChange?: (theme: ColorTheme) => void;
    onDashboardFontScaleChange?: (scalePct: number) => void;
    onShadcnCustomColorsChange?: (colors: Record<string, string>) => void;
}
/*
FNXC:SettingsScope 2026-07-16-08:10:
Appearance is now a PURE GLOBAL screen: theme, color, font scale, and language are all
`DEFAULT_GLOBAL_SETTINGS` and travel across every project, so the single per-screen scope
indicator ("Global") is honest for every control here. The task-presentation toggles that
used to sit below — and made this the one screen that mixed global and project scope — moved
to the sibling project screen `AppearanceProjectSection` ("Appearance · Project"). This split
is what lets the one-badge-per-screen model hold without a per-row exception: each Appearance
screen carries exactly one scope. See SchedulingSection/SchedulingGlobalSection for the same
scope-split precedent.
*/
export function AppearanceSection({ setForm, themeMode, colorTheme, dashboardFontScalePct, shadcnCustomColors = {}, resolvedThemeMode, onThemeModeChange, onColorThemeChange, onDashboardFontScaleChange, onShadcnCustomColorsChange, }: AppearanceSectionProps) {
    const { t } = useTranslation("app");
    return (<>
      <h4 className="settings-section-heading">{t("settings.appearance.title", "Appearance")}</h4>
      <ThemeSelector themeMode={themeMode} colorTheme={colorTheme} dashboardFontScalePct={dashboardFontScalePct} onThemeModeChange={(mode) => {
            setForm((f) => ({ ...f, themeMode: mode }));
            onThemeModeChange?.(mode);
        }} onColorThemeChange={(theme) => {
            setForm((f) => ({ ...f, colorTheme: theme }));
            onColorThemeChange?.(theme);
        }} onDashboardFontScaleChange={(scalePct) => {
            setForm((f) => ({ ...f, dashboardFontScalePct: scalePct }));
            onDashboardFontScaleChange?.(scalePct);
        }} shadcnCustomColors={shadcnCustomColors} resolvedThemeMode={resolvedThemeMode} onShadcnCustomColorsChange={(colors) => {
            setForm((f) => ({ ...f, shadcnCustomColors: colors }));
            onShadcnCustomColorsChange?.(colors);
        }}/>
      <LanguageSelector />
    </>);
}
export default AppearanceSection;
