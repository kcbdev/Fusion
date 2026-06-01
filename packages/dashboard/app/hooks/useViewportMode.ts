import { useState, useEffect } from "react";

export type ViewportMode = "mobile" | "tablet" | "desktop";

// `(max-height: 480px)` catches phones held in landscape, which can exceed
// 768 CSS px wide but stay short. Without it, landscape phones fall out of
// mobile mode and lose the bottom nav bar + get the desktop horizontally-
// scrollable board.
export const MOBILE_MEDIA_QUERY = "(max-width: 768px)";

export function getViewportMode(): ViewportMode {
  if (typeof window === "undefined") return "desktop";
  if (window.matchMedia(MOBILE_MEDIA_QUERY).matches) return "mobile";
  if (window.matchMedia("(min-width: 769px) and (max-width: 1024px)").matches) return "tablet";
  return "desktop";
}

export function useViewportMode(): ViewportMode {
  const [mode, setMode] = useState<ViewportMode>(getViewportMode);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mobileQuery = window.matchMedia(MOBILE_MEDIA_QUERY);
    const tabletQuery = window.matchMedia("(min-width: 769px) and (max-width: 1024px)");

    const updateMode = () => {
      if (mobileQuery.matches) {
        setMode("mobile");
      } else if (tabletQuery.matches) {
        setMode("tablet");
      } else {
        setMode("desktop");
      }
    };

    const addChangeListener = (query: MediaQueryList, listener: () => void) => {
      if (typeof query.addEventListener === "function") {
        query.addEventListener("change", listener);
        return;
      }
      if (typeof query.addListener === "function") {
        query.addListener(listener);
      }
    };

    const removeChangeListener = (query: MediaQueryList, listener: () => void) => {
      if (typeof query.removeEventListener === "function") {
        query.removeEventListener("change", listener);
        return;
      }
      if (typeof query.removeListener === "function") {
        query.removeListener(listener);
      }
    };

    addChangeListener(mobileQuery, updateMode);
    addChangeListener(tabletQuery, updateMode);
    return () => {
      removeChangeListener(mobileQuery, updateMode);
      removeChangeListener(tabletQuery, updateMode);
    };
  }, []);

  return mode;
}
