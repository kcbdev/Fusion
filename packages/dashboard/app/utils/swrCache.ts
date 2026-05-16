/**
 * Lightweight stale-while-revalidate cache helpers for dashboard reload hydration.
 *
 * Invalidation contract:
 * - Per-project task entries use `SWR_CACHE_KEYS.TASKS_PREFIX + projectId`.
 * - Version updates clear TASKS_PREFIX plus PROJECTS and CURRENT_PROJECT_ID.
 */
export const SWR_CACHE_KEYS = {
  PROJECTS: "kb-dashboard-projects-cache",
  CURRENT_PROJECT_ID: "kb-dashboard-current-project-cache",
  TASKS_PREFIX: "kb-dashboard-tasks-cache:",
} as const;

const DEFAULT_MAX_BYTES = 500_000;

function getLocalStorage(): Storage | null {
  if (typeof window !== "undefined" && window.localStorage) {
    return window.localStorage;
  }
  if (typeof localStorage !== "undefined") {
    return localStorage;
  }
  return null;
}

export function readCache<T>(key: string): T | null {
  const storage = getLocalStorage();
  if (!storage) {
    return null;
  }

  try {
    const raw = storage.getItem(key);
    if (raw === null) {
      return null;
    }

    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeCache<T>(key: string, value: T, options?: { maxBytes?: number }): void {
  const storage = getLocalStorage();
  if (!storage) {
    return;
  }

  try {
    const serialized = JSON.stringify(value);
    const maxBytes = options?.maxBytes ?? DEFAULT_MAX_BYTES;
    if (new TextEncoder().encode(serialized).length > maxBytes) {
      return;
    }

    storage.setItem(key, serialized);
  } catch {
    // Ignore quota and storage errors.
  }
}

export function clearCache(prefix: string): void {
  const storage = getLocalStorage();
  if (!storage) {
    return;
  }

  try {
    const keys = new Set<string>();

    for (const key in storage) {
      if (Object.prototype.hasOwnProperty.call(storage, key) && key.startsWith(prefix)) {
        keys.add(key);
      }
    }

    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (typeof key === "string" && key.startsWith(prefix)) {
        keys.add(key);
      }
    }

    for (const key of keys) {
      storage.removeItem(key);
    }
  } catch {
    // Ignore storage errors.
  }
}
