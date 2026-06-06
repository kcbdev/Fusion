/**
 * Per-project completion marker for the company-model five-step onboarding flow
 * (U12, sub-part B). Mirrors the localStorage shown-state pattern used by the
 * model onboarding (`model-onboarding-state.ts`) and the BoardSwitcher's
 * per-project selected-board key (U10): one key per project id so the flow is
 * NEVER re-shown for a project once it has been completed OR skipped.
 *
 * The marker is keyed by project id (not a single global key) because each new
 * project gets its own onboarding pass; completing onboarding for project A must
 * not suppress it for project B.
 */

const STORAGE_PREFIX = "fusion_company_onboarding";

/** Why the flow stopped being shown — purely informational for debugging. */
export type CompanyOnboardingOutcome = "completed" | "skipped";

interface CompanyOnboardingMarker {
  outcome: CompanyOnboardingOutcome;
  /** The step (1-based) the user was on when they skipped, if applicable. */
  atStep?: number;
  updatedAt: string;
}

function storageKey(projectId: string): string {
  return `${STORAGE_PREFIX}:${projectId}`;
}

/**
 * Whether the onboarding flow has already run for this project (completed or
 * skipped). When true the flow must never be shown again.
 */
export function isCompanyOnboardingDone(projectId: string): boolean {
  if (typeof window === "undefined") return false;
  if (!projectId) return false;
  try {
    return window.localStorage.getItem(storageKey(projectId)) !== null;
  } catch {
    return false;
  }
}

/**
 * Record that the onboarding flow finished for this project so it is never shown
 * again. Call this on completion AND on skip-at-any-step.
 */
export function markCompanyOnboardingDone(
  projectId: string,
  outcome: CompanyOnboardingOutcome,
  atStep?: number,
): void {
  if (typeof window === "undefined") return;
  if (!projectId) return;
  try {
    const marker: CompanyOnboardingMarker = {
      outcome,
      ...(atStep !== undefined ? { atStep } : {}),
      updatedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(storageKey(projectId), JSON.stringify(marker));
  } catch {
    // Storage quota / private browsing — fail silently (worst case the flow
    // shows once more on a subsequent project open, never blocking creation).
  }
}

/** Read the persisted marker, or null if onboarding has not run for the project. */
export function getCompanyOnboardingMarker(projectId: string): CompanyOnboardingMarker | null {
  if (typeof window === "undefined") return null;
  if (!projectId) return null;
  try {
    const raw = window.localStorage.getItem(storageKey(projectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && "outcome" in parsed) {
      return parsed as CompanyOnboardingMarker;
    }
    return null;
  } catch {
    return null;
  }
}

/** The persisted selected-board key (U10 / BoardSwitcher), mirrored here so the
 *  onboarding flow can land the user on the board it just created. */
export function setSelectedBoardForProject(projectId: string, boardId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`kb-dashboard-selected-board:${projectId || "__global__"}`, boardId);
  } catch {
    // ignore
  }
}
