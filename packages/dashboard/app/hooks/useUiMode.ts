import { useCallback, useEffect, useRef, useState } from "react";
import { resolveUiMode, UI_MODES, type UiMode } from "@fusion/core";
import { fetchGlobalSettings, updateGlobalSettings } from "../api";

const UI_MODE_STORAGE_KEY = "kb-dashboard-ui-mode";
const isBrowser = typeof window !== "undefined";

function isValidUiMode(value: unknown): value is UiMode {
  return typeof value === "string" && (UI_MODES as readonly string[]).includes(value);
}

function readCachedUiMode(): UiMode {
  if (!isBrowser) return "simple";
  try {
    const cached = window.localStorage.getItem(UI_MODE_STORAGE_KEY);
    if (isValidUiMode(cached)) return cached;
  } catch {
    // ignore storage failures
  }
  return "simple";
}

function writeCachedUiMode(mode: UiMode): void {
  if (!isBrowser) return;
  try {
    window.localStorage.setItem(UI_MODE_STORAGE_KEY, mode);
  } catch {
    // ignore storage failures
  }
}

export interface UseUiModeReturn {
  uiMode: UiMode;
  setUiMode: (mode: UiMode) => void;
  /**
   * True until the canonical uiMode has been hydrated from backend global
   * settings. Consumers that gate behavior on the resolved mode (e.g. deep-link
   * redirects) should wait for hydration to avoid acting on the stale cached
   * value.
   */
  isHydrating: boolean;
}

/**
 * Resolves the simple/advanced UI mode from global settings (U11).
 *
 * Mirrors the three-tier persistence pattern used by `useTheme`:
 * - Initializes from the localStorage cache (or `simple`) to avoid a flash.
 * - Hydrates the canonical value from backend global settings on mount, unless
 *   the user has already made a selection in this session (user intent wins).
 * - Write-through on `setUiMode`: state + cache + async backend update.
 *
 * The default is `simple` (resolved through `resolveUiMode`, the same authority
 * the engine consults), so the dashboard and TUI agree on the default.
 */
export function useUiMode(): UseUiModeReturn {
  const [uiMode, setUiModeState] = useState<UiMode>(() => readCachedUiMode());
  const [isHydrating, setIsHydrating] = useState(true);
  const uiModeRef = useRef(uiMode);
  const userSetUiModeRef = useRef(false);

  useEffect(() => {
    uiModeRef.current = uiMode;
  }, [uiMode]);

  useEffect(() => {
    if (!isBrowser || !isHydrating) return;
    let cancelled = false;

    void fetchGlobalSettings()
      .then((globalSettings) => {
        if (cancelled || userSetUiModeRef.current) return;
        const hydrated = resolveUiMode(globalSettings);
        if (uiModeRef.current !== hydrated) {
          uiModeRef.current = hydrated;
          setUiModeState(hydrated);
        }
        if (readCachedUiMode() !== hydrated) {
          writeCachedUiMode(hydrated);
        }
      })
      .catch((error) => {
        console.warn("[useUiMode] Failed to hydrate uiMode from global settings", error);
      })
      .finally(() => {
        if (!cancelled) setIsHydrating(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isHydrating]);

  const setUiMode = useCallback((mode: UiMode) => {
    userSetUiModeRef.current = true;
    uiModeRef.current = mode;
    setUiModeState(mode);
    writeCachedUiMode(mode);

    void updateGlobalSettings({ uiMode: mode }).catch((error) => {
      console.warn("[useUiMode] Failed to persist uiMode to global settings", error);
    });
  }, []);

  return { uiMode, setUiMode, isHydrating };
}
