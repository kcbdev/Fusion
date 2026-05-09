import { useCallback, useEffect, useMemo, useRef } from "react";

const SUSPENSION_ERROR_PATTERNS = [
  "load failed",
  "failed to fetch",
  "networkerror when attempting to fetch resource.",
  "connection aborted",
  "connection closed unexpectedly",
  "network error",
];

export function isLikelyTabSuspensionError(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return SUSPENSION_ERROR_PATTERNS.some((pattern) => normalized.includes(pattern));
}

export function useTabVisibilitySuspension() {
  const lastHiddenAtRef = useRef<number | null>(null);
  const lastVisibleAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const handleVisibilityChange = () => {
      const now = Date.now();
      if (document.visibilityState === "hidden") {
        lastHiddenAtRef.current = now;
        return;
      }
      if (document.visibilityState === "visible") {
        lastVisibleAtRef.current = now;
      }
    };

    handleVisibilityChange();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  const isHiddenNow = useCallback(() => typeof document !== "undefined" && document.visibilityState === "hidden", []);

  const wasRecentlyHidden = useCallback((windowMs = 5000): boolean => {
    const hiddenAt = lastHiddenAtRef.current;
    if (hiddenAt === null) {
      return false;
    }
    const now = Date.now();
    if (isHiddenNow()) {
      return now - hiddenAt <= windowMs;
    }

    const visibleAt = lastVisibleAtRef.current;
    if (visibleAt === null || visibleAt < hiddenAt) {
      return false;
    }
    return now - visibleAt <= windowMs;
  }, [isHiddenNow]);

  return useMemo(() => ({
    isHiddenNow,
    wasRecentlyHidden,
  }), [isHiddenNow, wasRecentlyHidden]);
}
