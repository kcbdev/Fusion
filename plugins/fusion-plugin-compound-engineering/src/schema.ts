import type { Database } from "@fusion/core";

/**
 * Idempotent DDL for the Compound Engineering plugin-local tables (U5).
 *
 * Wired via `hooks.onSchemaInit` and run against the same DB that route
 * handlers reach through `ctx.taskStore.getDatabase()` (the sanctioned
 * plugin-table access path; `PluginContext` exposes no `db` handle and the
 * loader `emitEvent` is a logging stub — see the U5 storage/event seam note).
 *
 * `ce_sessions` is the no-silent-loss core: every interactive stage session is
 * persisted here so an interrupt/error never destroys progress (lesson:
 * docs/incidents/2026-05-23-lost-work-tasks.md). The `currentQuestion` and
 * `conversationHistory` columns are JSON; resume reconstructs the awaiting
 * question and full history from them.
 *
 * `lastActivityAt` is an interval-relative liveness field (epoch millis of the
 * last produced event). Staleness is judged relative to the session's
 * configured turn interval, NOT by raw last-event age, so a healthy-but-slow
 * agent turn is not misclassified stale (docs/fn-4172-heartbeat-investigation.md).
 */
export function ensureCeSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ce_sessions (
      id TEXT PRIMARY KEY,
      stage TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN (
        'launching','active','awaiting_input','completed','error','interrupted'
      )),
      currentQuestion TEXT,
      conversationHistory TEXT NOT NULL DEFAULT '[]',
      projectId TEXT,
      artifactPath TEXT,
      error TEXT,
      turnIntervalMs INTEGER NOT NULL DEFAULT 120000,
      lastActivityAt INTEGER NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idxCeSessionsStatusUpdated
      ON ce_sessions(status, updatedAt DESC, id);

    CREATE INDEX IF NOT EXISTS idxCeSessionsStageCreated
      ON ce_sessions(stage, createdAt DESC, id);

    CREATE INDEX IF NOT EXISTS idxCeSessionsProject
      ON ce_sessions(projectId, updatedAt DESC, id);
  `);
}
