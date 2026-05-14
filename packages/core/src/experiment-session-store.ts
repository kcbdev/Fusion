import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { Database } from "./db.js";
import { fromJson, toJson, toJsonNullable } from "./db.js";
import type {
  ExperimentConfigRecordPayload,
  ExperimentRecordType,
  ExperimentSession,
  ExperimentSessionCreateInput,
  ExperimentSessionListOptions,
  ExperimentSessionRecord,
  ExperimentSessionRecordAppendInput,
  ExperimentSessionStatus,
  ExperimentSessionStoreEvents,
  ExperimentSessionUpdateInput,
} from "./experiment-session-types.js";

function generateId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

export class ExperimentSessionStore extends EventEmitter<ExperimentSessionStoreEvents> {
  private readonly insertSessionStmt;

  constructor(private readonly db: Database) {
    super();
    this.setMaxListeners(50);
    this.insertSessionStmt = this.db.prepare(`
      INSERT INTO experiment_sessions (
        id, name, projectId, status, metric, currentSegment, maxIterations, workingDir,
        baselineRunId, bestRunId, keptRunIds, tags, metadata, createdAt, updatedAt, finalizedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
  }

  createSession(input: ExperimentSessionCreateInput): ExperimentSession {
    const now = new Date().toISOString();
    const session: ExperimentSession = {
      id: generateId("EXP"),
      name: input.name,
      projectId: input.projectId,
      status: input.status ?? "active",
      metric: input.metric,
      currentSegment: input.currentSegment ?? 1,
      maxIterations: input.maxIterations,
      workingDir: input.workingDir,
      baselineRunId: input.baselineRunId,
      bestRunId: input.bestRunId,
      keptRunIds: input.keptRunIds ?? [],
      tags: input.tags ?? [],
      metadata: input.metadata,
      createdAt: now,
      updatedAt: now,
      finalizedAt: input.finalizedAt,
    };

    this.insertSessionStmt.run(
      session.id,
      session.name,
      session.projectId ?? null,
      session.status,
      toJson(session.metric),
      session.currentSegment,
      session.maxIterations ?? null,
      session.workingDir ?? null,
      session.baselineRunId ?? null,
      session.bestRunId ?? null,
      toJson(session.keptRunIds),
      toJson(session.tags),
      toJsonNullable(session.metadata),
      session.createdAt,
      session.updatedAt,
      session.finalizedAt ?? null,
    );

    this.db.bumpLastModified();
    this.emit("session:created", session);
    return session;
  }

  getSession(id: string): ExperimentSession | undefined {
    const row = this.db.prepare("SELECT * FROM experiment_sessions WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToSession(row) : undefined;
  }

  listSessions(options: ExperimentSessionListOptions = {}): ExperimentSession[] {
    const where: string[] = [];
    const params: Array<string | number> = [];

    if (options.status) {
      where.push("status = ?");
      params.push(options.status);
    }
    if (options.projectId) {
      where.push("projectId = ?");
      params.push(options.projectId);
    }
    if (options.tag) {
      where.push("tags LIKE ?");
      params.push(`%"${options.tag}"%`);
    }
    if (options.search) {
      where.push("(name LIKE ? OR COALESCE(workingDir, '') LIKE ?)");
      params.push(`%${options.search}%`, `%${options.search}%`);
    }

    const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const limitClause = options.limit !== undefined ? `LIMIT ${options.limit}` : "";
    const offsetClause = options.offset !== undefined ? `OFFSET ${options.offset}` : "";

    const rows = this.db.prepare(`
      SELECT * FROM experiment_sessions
      ${whereClause}
      ORDER BY createdAt DESC
      ${limitClause}
      ${offsetClause}
    `).all(...params) as Record<string, unknown>[];

    return rows.map((row) => this.rowToSession(row));
  }

  updateSession(id: string, patch: ExperimentSessionUpdateInput): ExperimentSession {
    const existing = this.getSession(id);
    if (!existing) throw new Error(`Experiment session not found: ${id}`);

    const now = new Date().toISOString();
    const status = patch.status ?? existing.status;
    const finalizedAt = status === "finalized" ? (patch.finalizedAt ?? existing.finalizedAt ?? now) : (patch.finalizedAt ?? existing.finalizedAt);
    const updated: ExperimentSession = {
      ...existing,
      ...patch,
      status,
      finalizedAt,
      updatedAt: now,
    };

    this.persistSession(updated);
    this.db.bumpLastModified();
    this.emit("session:updated", updated);
    if (updated.status !== existing.status) {
      this.emit("session:status_changed", updated);
      if (updated.status === "finalized") {
        this.emit("session:finalized", updated);
      }
    }
    return updated;
  }

  deleteSession(id: string): boolean {
    const result = this.db.prepare("DELETE FROM experiment_sessions WHERE id = ?").run(id) as { changes?: number };
    const deleted = (result.changes ?? 0) > 0;
    if (deleted) {
      this.db.bumpLastModified();
      this.emit("session:deleted", id);
    }
    return deleted;
  }

  appendRecord(sessionId: string, input: ExperimentSessionRecordAppendInput): ExperimentSessionRecord {
    const session = this.getSession(sessionId);
    if (!session) throw new Error(`Experiment session not found: ${sessionId}`);
    if (session.status === "finalized" || session.status === "archived") {
      throw new Error(`Cannot append record to ${session.status} session: ${sessionId}`);
    }

    const now = new Date().toISOString();
    const record = this.db.transaction(() => {
      const seqRow = this.db
        .prepare("SELECT COALESCE(MAX(seq), 0) + 1 as nextSeq FROM experiment_session_records WHERE sessionId = ?")
        .get(sessionId) as { nextSeq: number };
      const nextSeq = seqRow.nextSeq;
      const created: ExperimentSessionRecord = {
        id: generateId("EXPR"),
        sessionId,
        segment: input.segment ?? session.currentSegment,
        seq: nextSeq,
        type: input.type,
        payload: input.payload,
        createdAt: now,
      } as ExperimentSessionRecord;

      this.db.prepare(`
        INSERT INTO experiment_session_records (id, sessionId, segment, seq, type, payload, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(created.id, created.sessionId, created.segment, created.seq, created.type, toJson(created.payload), created.createdAt);

      return created;
    });

    this.db.bumpLastModified();
    this.emit("record:appended", record);
    return record;
  }

  listRecords(sessionId: string, opts: { segment?: number; type?: ExperimentRecordType; limit?: number; offset?: number } = {}): ExperimentSessionRecord[] {
    const where = ["sessionId = ?"];
    const params: Array<string | number> = [sessionId];

    if (opts.segment !== undefined) {
      where.push("segment = ?");
      params.push(opts.segment);
    }
    if (opts.type) {
      where.push("type = ?");
      params.push(opts.type);
    }

    const limitClause = opts.limit !== undefined ? `LIMIT ${opts.limit}` : "";
    const offsetClause = opts.offset !== undefined ? `OFFSET ${opts.offset}` : "";

    const rows = this.db.prepare(`
      SELECT * FROM experiment_session_records
      WHERE ${where.join(" AND ")}
      ORDER BY seq ASC
      ${limitClause}
      ${offsetClause}
    `).all(...params) as Record<string, unknown>[];

    return rows.map((row) => this.rowToRecord(row));
  }

  getRecord(id: string): ExperimentSessionRecord | undefined {
    const row = this.db.prepare("SELECT * FROM experiment_session_records WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToRecord(row) : undefined;
  }

  startNewSegment(sessionId: string, configPayload: ExperimentConfigRecordPayload): { session: ExperimentSession; record: ExperimentSessionRecord } {
    const result = this.db.transaction(() => {
      const session = this.getSession(sessionId);
      if (!session) throw new Error(`Experiment session not found: ${sessionId}`);
      const nextSegment = session.currentSegment + 1;
      const updated: ExperimentSession = { ...session, currentSegment: nextSegment, updatedAt: new Date().toISOString() };
      this.persistSession(updated);

      const seqRow = this.db
        .prepare("SELECT COALESCE(MAX(seq), 0) + 1 as nextSeq FROM experiment_session_records WHERE sessionId = ?")
        .get(sessionId) as { nextSeq: number };

      const record: ExperimentSessionRecord = {
        id: generateId("EXPR"),
        sessionId,
        segment: nextSegment,
        seq: seqRow.nextSeq,
        type: "config",
        payload: configPayload,
        createdAt: new Date().toISOString(),
      };

      this.db.prepare(`
        INSERT INTO experiment_session_records (id, sessionId, segment, seq, type, payload, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(record.id, record.sessionId, record.segment, record.seq, record.type, toJson(record.payload), record.createdAt);

      return { session: updated, record };
    });

    this.db.bumpLastModified();
    this.emit("segment:reset", { sessionId, segment: result.session.currentSegment });
    this.emit("record:appended", result.record);
    return result;
  }

  setBaselineRun(sessionId: string, runRecordId: string): ExperimentSession {
    const session = this.assertRunRecordOwnership(sessionId, runRecordId);
    return this.updateSession(session.id, { baselineRunId: runRecordId });
  }

  setBestRun(sessionId: string, runRecordId: string): ExperimentSession {
    const session = this.assertRunRecordOwnership(sessionId, runRecordId);
    return this.updateSession(session.id, { bestRunId: runRecordId });
  }

  recordKept(sessionId: string, runRecordId: string): ExperimentSession {
    const session = this.assertRunRecordOwnership(sessionId, runRecordId);
    const keptRunIds = session.keptRunIds.includes(runRecordId)
      ? session.keptRunIds
      : [...session.keptRunIds, runRecordId];
    return this.updateSession(sessionId, { keptRunIds });
  }

  private assertRunRecordOwnership(sessionId: string, runRecordId: string): ExperimentSession {
    const session = this.getSession(sessionId);
    if (!session) throw new Error(`Experiment session not found: ${sessionId}`);
    const record = this.getRecord(runRecordId);
    if (!record) throw new Error(`Experiment record not found: ${runRecordId}`);
    if (record.type !== "run") throw new Error(`Experiment record is not a run: ${runRecordId}`);
    if (record.sessionId !== sessionId) throw new Error(`Experiment record ${runRecordId} does not belong to session ${sessionId}`);
    return session;
  }

  private persistSession(session: ExperimentSession): void {
    this.db.prepare(`
      UPDATE experiment_sessions
      SET name = ?, projectId = ?, status = ?, metric = ?, currentSegment = ?, maxIterations = ?,
          workingDir = ?, baselineRunId = ?, bestRunId = ?, keptRunIds = ?, tags = ?, metadata = ?,
          updatedAt = ?, finalizedAt = ?
      WHERE id = ?
    `).run(
      session.name,
      session.projectId ?? null,
      session.status,
      toJson(session.metric),
      session.currentSegment,
      session.maxIterations ?? null,
      session.workingDir ?? null,
      session.baselineRunId ?? null,
      session.bestRunId ?? null,
      toJson(session.keptRunIds),
      toJson(session.tags),
      toJsonNullable(session.metadata),
      session.updatedAt,
      session.finalizedAt ?? null,
      session.id,
    );
  }

  private rowToSession(row: Record<string, unknown>): ExperimentSession {
    return {
      id: row.id as string,
      name: row.name as string,
      projectId: (row.projectId as string | null) ?? undefined,
      status: row.status as ExperimentSessionStatus,
      metric: fromJson<ExperimentSession["metric"]>(row.metric as string | null) ?? { name: "unknown", direction: "maximize" },
      currentSegment: Number(row.currentSegment ?? 1),
      maxIterations: (row.maxIterations as number | null) ?? undefined,
      workingDir: (row.workingDir as string | null) ?? undefined,
      baselineRunId: (row.baselineRunId as string | null) ?? undefined,
      bestRunId: (row.bestRunId as string | null) ?? undefined,
      keptRunIds: fromJson<string[]>(row.keptRunIds as string | null) ?? [],
      tags: fromJson<string[]>(row.tags as string | null) ?? [],
      metadata: fromJson<Record<string, unknown>>(row.metadata as string | null),
      createdAt: row.createdAt as string,
      updatedAt: row.updatedAt as string,
      finalizedAt: (row.finalizedAt as string | null) ?? undefined,
    };
  }

  private rowToRecord(row: Record<string, unknown>): ExperimentSessionRecord {
    return {
      id: row.id as string,
      sessionId: row.sessionId as string,
      segment: Number(row.segment),
      seq: Number(row.seq),
      type: row.type as ExperimentSessionRecord["type"],
      payload: fromJson<ExperimentSessionRecord["payload"]>(row.payload as string | null) ?? {},
      createdAt: row.createdAt as string,
    } as ExperimentSessionRecord;
  }
}
