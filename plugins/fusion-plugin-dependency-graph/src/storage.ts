import { getScopedItem, scopedKey, setScopedItem } from "../../../packages/dashboard/app/utils/projectStorage";

const BASE_KEY = "fusion-plugin-dependency-graph:positions";

export function projectScopedKey(projectId?: string): string {
  return scopedKey(BASE_KEY, projectId);
}

export function loadPositions(projectId?: string): Record<string, { x: number; y: number }> {
  try {
    const raw = getScopedItem(BASE_KEY, projectId);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, { x: number; y: number }>;
    return parsed ?? {};
  } catch {
    return {};
  }
}

export function savePositions(projectId: string | undefined, positions: Record<string, { x: number; y: number }>): void {
  setScopedItem(BASE_KEY, JSON.stringify(positions), projectId);
}
