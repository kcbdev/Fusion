import type {
  CreateTestPlanInput,
  CreateTestRunInput,
  QualityPresetId,
  SuggestedCasesSnapshot,
  TestPlan,
  TestPlanStatus,
  TestRun,
  TestRunStatus,
} from "./quality-types.js";

/*
FNXC:QualityPostgres 2026-07-16-09:03:
Runtime QA surfaces must not touch SQLite. Production Fusion is PostgreSQL-only
(AsyncDataLayer); any path that calls TaskStore.getDatabase() throws
"SQLite Database is not available in backend mode". This async API is the only
store contract routes and the command runner may use.
*/

export type QualityRunPatch = Partial<{
  status: TestRunStatus;
  exitCode: number | null;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  stdout: string;
  stderr: string;
}>;

export interface QualityStoreApi {
  createRun(input: CreateTestRunInput): Promise<TestRun>;
  getRun(projectId: string, id: string): Promise<TestRun | null>;
  listRuns(projectId: string, opts?: { taskId?: string; limit?: number }): Promise<TestRun[]>;
  updateRun(projectId: string, id: string, patch: QualityRunPatch): Promise<TestRun | null>;
  pruneRuns(projectId: string, retention: number): Promise<number>;
  findActiveRun(projectId: string, taskId?: string): Promise<TestRun | null>;
  createPlan(input: CreateTestPlanInput): Promise<TestPlan>;
  getPlan(projectId: string, id: string): Promise<TestPlan | null>;
  listPlans(projectId: string, opts?: { includeArchived?: boolean }): Promise<TestPlan[]>;
  updatePlan(
    projectId: string,
    id: string,
    patch: Partial<{ name: string; status: TestPlanStatus; steps: QualityPresetId[] }>,
  ): Promise<TestPlan | null>;
  getSuggestedCases(projectId: string, taskId: string): Promise<SuggestedCasesSnapshot | null>;
  saveSuggestedCases(snapshot: SuggestedCasesSnapshot): Promise<SuggestedCasesSnapshot>;
}
