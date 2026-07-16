import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { AsyncDataLayer } from "@fusion/core";
import type { QualityStoreApi, QualityRunPatch } from "./quality-store-api.js";
import type {
  CreateTestPlanInput,
  CreateTestRunInput,
  QualityPresetId,
  SuggestedCase,
  SuggestedCasesSnapshot,
  TestPlan,
  TestPlanStatus,
  TestRun,
  TestRunStatus,
} from "./quality-types.js";

/*
FNXC:QualityPostgres 2026-07-16-09:03:
PostgreSQL-backed Quality persistence via the project AsyncDataLayer. Tables live
in schema project.* (quality_test_runs / quality_test_plans / quality_suggested_cases)
created by onPostgresSchemaInit. Every predicate is project_id-scoped.
Import sql from drizzle-orm directly — plugin runtime shims do not re-export it.
*/

type RunRow = {
  id: string;
  project_id: string;
  task_id: string | null;
  plan_id: string | null;
  source: string;
  preset_id: string | null;
  command: string;
  cwd: string;
  cwd_kind: string;
  status: string;
  exit_code: number | null;
  error_message: string | null;
  timeout_ms: number;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  stdout: string;
  stderr: string;
  triggered_by: string;
  created_at: string;
  updated_at: string;
};

type PlanRow = {
  id: string;
  project_id: string;
  name: string;
  status: string;
  steps_json: string;
  created_at: string;
  updated_at: string;
};

type CasesRow = {
  project_id: string;
  task_id: string;
  cases_json: string;
  generated_at: string;
  method: string;
};

function mapRun(row: RunRow): TestRun {
  return {
    id: row.id,
    projectId: row.project_id,
    taskId: row.task_id ?? undefined,
    planId: row.plan_id ?? undefined,
    source: row.source as TestRun["source"],
    presetId: (row.preset_id as QualityPresetId | null) ?? undefined,
    command: row.command,
    cwd: row.cwd,
    cwdKind: row.cwd_kind as TestRun["cwdKind"],
    status: row.status as TestRunStatus,
    exitCode: row.exit_code ?? undefined,
    errorMessage: row.error_message ?? undefined,
    timeoutMs: row.timeout_ms,
    startedAt: row.started_at ?? undefined,
    finishedAt: row.finished_at ?? undefined,
    durationMs: row.duration_ms ?? undefined,
    stdout: row.stdout ?? "",
    stderr: row.stderr ?? "",
    triggeredBy: row.triggered_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPlan(row: PlanRow): TestPlan {
  let steps: QualityPresetId[] = [];
  try {
    const parsed = JSON.parse(row.steps_json) as unknown;
    if (Array.isArray(parsed)) {
      steps = parsed.filter((s): s is QualityPresetId => typeof s === "string");
    }
  } catch {
    steps = [];
  }
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    status: row.status as TestPlanStatus,
    steps,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function asRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && Array.isArray((result as { rows?: unknown }).rows)) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

export class AsyncQualityStore implements QualityStoreApi {
  private readonly projectId: string;

  constructor(private readonly layer: AsyncDataLayer) {
    const projectId = layer.projectId?.trim();
    if (!projectId) {
      throw new Error("Quality PostgreSQL persistence requires a project-bound AsyncDataLayer");
    }
    this.projectId = projectId;
  }

  async createRun(input: CreateTestRunInput): Promise<TestRun> {
    const now = new Date().toISOString();
    const id = `qrun_${randomUUID()}`;
    await this.layer.db.execute(sql`
      INSERT INTO project.quality_test_runs (
        id, project_id, task_id, plan_id, source, preset_id, command, cwd, cwd_kind,
        status, timeout_ms, stdout, stderr, triggered_by, created_at, updated_at
      ) VALUES (
        ${id}, ${input.projectId}, ${input.taskId ?? null}, ${input.planId ?? null},
        ${input.source}, ${input.presetId ?? null}, ${input.command}, ${input.cwd}, ${input.cwdKind},
        ${"queued"}, ${input.timeoutMs}, ${""}, ${""}, ${input.triggeredBy}, ${now}, ${now}
      )
    `);
    const run = await this.getRun(input.projectId, id);
    if (!run) throw new Error(`Quality run ${id} missing after insert`);
    return run;
  }

  async getRun(projectId: string, id: string): Promise<TestRun | null> {
    const rows = asRows<RunRow>(
      await this.layer.db.execute(
        sql`SELECT * FROM project.quality_test_runs WHERE project_id = ${projectId} AND id = ${id} LIMIT 1`,
      ),
    );
    return rows[0] ? mapRun(rows[0]) : null;
  }

  async listRuns(projectId: string, opts?: { taskId?: string; limit?: number }): Promise<TestRun[]> {
    const limit = opts?.limit && opts.limit > 0 ? Math.min(opts.limit, 200) : 50;
    if (opts?.taskId) {
      const rows = asRows<RunRow>(
        await this.layer.db.execute(sql`
          SELECT * FROM project.quality_test_runs
          WHERE project_id = ${projectId} AND task_id = ${opts.taskId}
          ORDER BY created_at DESC, id DESC
          LIMIT ${limit}
        `),
      );
      return rows.map(mapRun);
    }
    const rows = asRows<RunRow>(
      await this.layer.db.execute(sql`
        SELECT * FROM project.quality_test_runs
        WHERE project_id = ${projectId}
        ORDER BY created_at DESC, id DESC
        LIMIT ${limit}
      `),
    );
    return rows.map(mapRun);
  }

  async updateRun(projectId: string, id: string, patch: QualityRunPatch): Promise<TestRun | null> {
    const existing = await this.getRun(projectId, id);
    if (!existing) return null;
    const now = new Date().toISOString();
    const status = patch.status ?? existing.status;
    const exitCode = patch.exitCode !== undefined ? patch.exitCode : (existing.exitCode ?? null);
    const errorMessage =
      patch.errorMessage !== undefined ? patch.errorMessage : (existing.errorMessage ?? null);
    const startedAt = patch.startedAt !== undefined ? patch.startedAt : (existing.startedAt ?? null);
    const finishedAt =
      patch.finishedAt !== undefined ? patch.finishedAt : (existing.finishedAt ?? null);
    const durationMs =
      patch.durationMs !== undefined ? patch.durationMs : (existing.durationMs ?? null);
    const stdout = patch.stdout !== undefined ? patch.stdout : existing.stdout;
    const stderr = patch.stderr !== undefined ? patch.stderr : existing.stderr;
    await this.layer.db.execute(sql`
      UPDATE project.quality_test_runs SET
        status = ${status},
        exit_code = ${exitCode},
        error_message = ${errorMessage},
        started_at = ${startedAt},
        finished_at = ${finishedAt},
        duration_ms = ${durationMs},
        stdout = ${stdout},
        stderr = ${stderr},
        updated_at = ${now}
      WHERE project_id = ${projectId} AND id = ${id}
    `);
    return this.getRun(projectId, id);
  }

  async pruneRuns(projectId: string, retention: number): Promise<number> {
    if (retention <= 0) return 0;
    const result = await this.layer.db.execute(sql`
      DELETE FROM project.quality_test_runs
      WHERE project_id = ${projectId}
        AND status NOT IN ('queued', 'running')
        AND id NOT IN (
          SELECT id FROM project.quality_test_runs
          WHERE project_id = ${projectId} AND status NOT IN ('queued', 'running')
          ORDER BY created_at DESC, id DESC
          LIMIT ${retention}
        )
    `);
    const count =
      result && typeof result === "object" && "rowCount" in result
        ? Number((result as { rowCount?: number }).rowCount ?? 0)
        : 0;
    return count;
  }

  async findActiveRun(projectId: string, taskId?: string): Promise<TestRun | null> {
    if (taskId) {
      const rows = asRows<RunRow>(
        await this.layer.db.execute(sql`
          SELECT * FROM project.quality_test_runs
          WHERE project_id = ${projectId} AND task_id = ${taskId}
            AND status IN ('queued', 'running')
          ORDER BY created_at DESC
          LIMIT 1
        `),
      );
      return rows[0] ? mapRun(rows[0]) : null;
    }
    const rows = asRows<RunRow>(
      await this.layer.db.execute(sql`
        SELECT * FROM project.quality_test_runs
        WHERE project_id = ${projectId} AND task_id IS NULL
          AND status IN ('queued', 'running')
        ORDER BY created_at DESC
        LIMIT 1
      `),
    );
    return rows[0] ? mapRun(rows[0]) : null;
  }

  async createPlan(input: CreateTestPlanInput): Promise<TestPlan> {
    const now = new Date().toISOString();
    const id = `qplan_${randomUUID()}`;
    const status = input.status ?? "active";
    const stepsJson = JSON.stringify(input.steps);
    await this.layer.db.execute(sql`
      INSERT INTO project.quality_test_plans (id, project_id, name, status, steps_json, created_at, updated_at)
      VALUES (${id}, ${input.projectId}, ${input.name}, ${status}, ${stepsJson}, ${now}, ${now})
    `);
    const plan = await this.getPlan(input.projectId, id);
    if (!plan) throw new Error(`Quality plan ${id} missing after insert`);
    return plan;
  }

  async getPlan(projectId: string, id: string): Promise<TestPlan | null> {
    const rows = asRows<PlanRow>(
      await this.layer.db.execute(
        sql`SELECT * FROM project.quality_test_plans WHERE project_id = ${projectId} AND id = ${id} LIMIT 1`,
      ),
    );
    return rows[0] ? mapPlan(rows[0]) : null;
  }

  async listPlans(projectId: string, opts?: { includeArchived?: boolean }): Promise<TestPlan[]> {
    if (opts?.includeArchived) {
      const rows = asRows<PlanRow>(
        await this.layer.db.execute(sql`
          SELECT * FROM project.quality_test_plans WHERE project_id = ${projectId}
          ORDER BY updated_at DESC, id DESC
        `),
      );
      return rows.map(mapPlan);
    }
    const rows = asRows<PlanRow>(
      await this.layer.db.execute(sql`
        SELECT * FROM project.quality_test_plans
        WHERE project_id = ${projectId} AND status != 'archived'
        ORDER BY updated_at DESC, id DESC
      `),
    );
    return rows.map(mapPlan);
  }

  async updatePlan(
    projectId: string,
    id: string,
    patch: Partial<{ name: string; status: TestPlanStatus; steps: QualityPresetId[] }>,
  ): Promise<TestPlan | null> {
    const existing = await this.getPlan(projectId, id);
    if (!existing) return null;
    const now = new Date().toISOString();
    const name = patch.name ?? existing.name;
    const status = patch.status ?? existing.status;
    const stepsJson = JSON.stringify(patch.steps ?? existing.steps);
    await this.layer.db.execute(sql`
      UPDATE project.quality_test_plans
      SET name = ${name}, status = ${status}, steps_json = ${stepsJson}, updated_at = ${now}
      WHERE project_id = ${projectId} AND id = ${id}
    `);
    return this.getPlan(projectId, id);
  }

  async getSuggestedCases(projectId: string, taskId: string): Promise<SuggestedCasesSnapshot | null> {
    const rows = asRows<CasesRow>(
      await this.layer.db.execute(sql`
        SELECT project_id, task_id, cases_json, generated_at, method
        FROM project.quality_suggested_cases
        WHERE project_id = ${projectId} AND task_id = ${taskId}
        LIMIT 1
      `),
    );
    const row = rows[0];
    if (!row) return null;
    let cases: SuggestedCase[] = [];
    try {
      const parsed = JSON.parse(row.cases_json) as unknown;
      if (Array.isArray(parsed)) cases = parsed as SuggestedCase[];
    } catch {
      cases = [];
    }
    return {
      projectId: row.project_id,
      taskId: row.task_id,
      cases,
      generatedAt: row.generated_at,
      method: row.method as SuggestedCasesSnapshot["method"],
    };
  }

  async saveSuggestedCases(snapshot: SuggestedCasesSnapshot): Promise<SuggestedCasesSnapshot> {
    const casesJson = JSON.stringify(snapshot.cases);
    await this.layer.db.execute(sql`
      INSERT INTO project.quality_suggested_cases (project_id, task_id, cases_json, generated_at, method)
      VALUES (${snapshot.projectId}, ${snapshot.taskId}, ${casesJson}, ${snapshot.generatedAt}, ${snapshot.method})
      ON CONFLICT (project_id, task_id) DO UPDATE SET
        cases_json = EXCLUDED.cases_json,
        generated_at = EXCLUDED.generated_at,
        method = EXCLUDED.method
    `);
    return snapshot;
  }
}
