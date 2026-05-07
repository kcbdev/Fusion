import { randomUUID } from "node:crypto";
import type { Database } from "./db.js";
import type {
  DistributedTaskIdAbortInput,
  DistributedTaskIdAbortResult,
  DistributedTaskIdCommitInput,
  DistributedTaskIdCommitResult,
  DistributedTaskIdReserveInput,
  DistributedTaskIdReserveResult,
  DistributedTaskIdStateInput,
  DistributedTaskIdStateResult,
} from "./types.js";

const DEFAULT_RESERVATION_TTL_MS = 15 * 60 * 1000;

export interface DistributedTaskIdAllocator {
  formatDistributedTaskId(prefix: string, sequence: number): string;
  reserveDistributedTaskId(input: DistributedTaskIdReserveInput): Promise<DistributedTaskIdReserveResult>;
  commitDistributedTaskIdReservation(input: DistributedTaskIdCommitInput): Promise<DistributedTaskIdCommitResult>;
  abortDistributedTaskIdReservation(input: DistributedTaskIdAbortInput): Promise<DistributedTaskIdAbortResult>;
  getDistributedTaskIdState(input: DistributedTaskIdStateInput): Promise<DistributedTaskIdStateResult>;
}

export class DistributedTaskIdError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "reservation_not_found"
      | "reservation_not_owned"
      | "reservation_expired"
      | "reservation_finalized"
      | "invalid_prefix",
  ) {
    super(message);
  }
}

type ReservationRow = {
  reservationId: string;
  prefix: string;
  nodeId: string;
  sequence: number;
  taskId: string;
  status: "reserved" | "committed" | "aborted" | "expired";
  reason: "abort" | "expired" | "failed-create" | null;
  expiresAt: string;
  committedAt: string | null;
  abortedAt: string | null;
};

export function formatDistributedTaskId(prefix: string, sequence: number): string {
  const normalizedPrefix = prefix.trim().toUpperCase();
  if (!normalizedPrefix) {
    throw new DistributedTaskIdError("prefix is required", "invalid_prefix");
  }
  return `${normalizedPrefix}-${String(sequence).padStart(3, "0")}`;
}

export function createDistributedTaskIdAllocator(db: Database): DistributedTaskIdAllocator {
  let opLock: Promise<void> = Promise.resolve();
  const withLock = async <T>(fn: () => Promise<T>): Promise<T> => {
    const prev = opLock;
    let resolve!: () => void;
    opLock = new Promise<void>((r) => {
      resolve = r;
    });
    await prev;
    try {
      return await fn();
    } finally {
      resolve();
    }
  };

  const expireReservations = (nowIso: string): number => {
    const result = db.prepare(
      `UPDATE distributed_task_id_reservations
       SET status = 'expired', reason = 'expired', abortedAt = ?
       WHERE status = 'reserved' AND expiresAt <= ?`,
    ).run(nowIso, nowIso) as { changes?: number };
    return result.changes ?? 0;
  };

  const ensureStateRow = (prefix: string): void => {
    db.prepare(
      `INSERT OR IGNORE INTO distributed_task_id_state (
        prefix, nextSequence, committedClusterTaskCount, lastCommittedTaskId, updatedAt
      ) VALUES (?, 1, 0, NULL, ?)`
    ).run(prefix, new Date().toISOString());
  };

  return {
    formatDistributedTaskId,
    reserveDistributedTaskId: async (input) =>
      withLock(async () => {
        const ttlMs = input.ttlMs ?? DEFAULT_RESERVATION_TTL_MS;
        const now = new Date();
        const nowIso = now.toISOString();
        const expiresAt = new Date(now.getTime() + ttlMs).toISOString();

        return db.transaction(() => {
          expireReservations(nowIso);
          const prefix = input.prefix.trim().toUpperCase();
          if (!prefix) {
            throw new DistributedTaskIdError("prefix is required", "invalid_prefix");
          }
          ensureStateRow(prefix);

          const state = db
            .prepare(
              "SELECT nextSequence, committedClusterTaskCount FROM distributed_task_id_state WHERE prefix = ?",
            )
            .get(prefix) as { nextSequence: number; committedClusterTaskCount: number };

          const sequence = state.nextSequence;
          const taskId = formatDistributedTaskId(prefix, sequence);
          const reservationId = randomUUID();

          db.prepare(
            `INSERT INTO distributed_task_id_reservations (
              reservationId, prefix, nodeId, sequence, taskId, status, reason, expiresAt, createdAt, updatedAt
            ) VALUES (?, ?, ?, ?, ?, 'reserved', NULL, ?, ?, ?)`
          ).run(reservationId, prefix, input.nodeId, sequence, taskId, expiresAt, nowIso, nowIso);

          db.prepare(
            "UPDATE distributed_task_id_state SET nextSequence = ?, updatedAt = ? WHERE prefix = ?",
          ).run(sequence + 1, nowIso, prefix);
          db.bumpLastModified();

          return {
            reservationId,
            taskId,
            sequence,
            expiresAt,
            committedClusterTaskCount: state.committedClusterTaskCount,
          };
        });
      }),
    commitDistributedTaskIdReservation: async (input) =>
      withLock(async () => {
        const nowIso = new Date().toISOString();
        return db.transaction(() => {
          expireReservations(nowIso);
          const row = db
            .prepare(
              `SELECT reservationId, prefix, nodeId, sequence, taskId, status, reason, expiresAt, committedAt, abortedAt
               FROM distributed_task_id_reservations
               WHERE reservationId = ?`,
            )
            .get(input.reservationId) as ReservationRow | undefined;

          if (!row) {
            throw new DistributedTaskIdError("reservation not found", "reservation_not_found");
          }
          if (row.nodeId !== input.nodeId) {
            throw new DistributedTaskIdError("reservation belongs to a different node", "reservation_not_owned");
          }
          if (row.status === "expired") {
            throw new DistributedTaskIdError("reservation has expired", "reservation_expired");
          }
          if (row.status !== "reserved") {
            throw new DistributedTaskIdError("reservation already finalized", "reservation_finalized");
          }

          db.prepare(
            `UPDATE distributed_task_id_reservations
             SET status = 'committed', committedAt = ?, updatedAt = ?
             WHERE reservationId = ?`,
          ).run(nowIso, nowIso, row.reservationId);

          ensureStateRow(row.prefix);
          db.prepare(
            `UPDATE distributed_task_id_state
             SET committedClusterTaskCount = committedClusterTaskCount + 1,
                 lastCommittedTaskId = ?,
                 updatedAt = ?
             WHERE prefix = ?`,
          ).run(row.taskId, nowIso, row.prefix);

          const state = db
            .prepare(
              "SELECT committedClusterTaskCount FROM distributed_task_id_state WHERE prefix = ?",
            )
            .get(row.prefix) as { committedClusterTaskCount: number };
          db.bumpLastModified();

          return {
            reservationId: row.reservationId,
            taskId: row.taskId,
            sequence: row.sequence,
            committedClusterTaskCount: state.committedClusterTaskCount,
            committedAt: nowIso,
          };
        });
      }),
    abortDistributedTaskIdReservation: async (input) =>
      withLock(async () => {
        const nowIso = new Date().toISOString();
        return db.transaction(() => {
          expireReservations(nowIso);
          const row = db
            .prepare(
              `SELECT reservationId, prefix, nodeId, sequence, taskId, status, reason, expiresAt, committedAt, abortedAt
               FROM distributed_task_id_reservations
               WHERE reservationId = ?`,
            )
            .get(input.reservationId) as ReservationRow | undefined;

          if (!row) {
            throw new DistributedTaskIdError("reservation not found", "reservation_not_found");
          }
          if (row.nodeId !== input.nodeId) {
            throw new DistributedTaskIdError("reservation belongs to a different node", "reservation_not_owned");
          }
          if (row.status === "committed") {
            throw new DistributedTaskIdError("reservation already finalized", "reservation_finalized");
          }

          if (row.status === "reserved") {
            db.prepare(
              `UPDATE distributed_task_id_reservations
               SET status = 'aborted', reason = ?, abortedAt = ?, updatedAt = ?
               WHERE reservationId = ?`,
            ).run(input.reason, nowIso, nowIso, row.reservationId);
          }

          ensureStateRow(row.prefix);
          const state = db
            .prepare(
              "SELECT committedClusterTaskCount FROM distributed_task_id_state WHERE prefix = ?",
            )
            .get(row.prefix) as { committedClusterTaskCount: number };
          db.bumpLastModified();

          return {
            reservationId: row.reservationId,
            taskId: row.taskId,
            sequence: row.sequence,
            committedClusterTaskCount: state.committedClusterTaskCount,
            abortedAt: nowIso,
          };
        });
      }),
    getDistributedTaskIdState: async (input) =>
      withLock(async () => {
        const nowIso = new Date().toISOString();
        return db.transaction(() => {
          expireReservations(nowIso);
          const prefix = input.prefix.trim().toUpperCase();
          if (!prefix) {
            throw new DistributedTaskIdError("prefix is required", "invalid_prefix");
          }
          ensureStateRow(prefix);
          const row = db
            .prepare(
              `SELECT nextSequence, committedClusterTaskCount, lastCommittedTaskId
               FROM distributed_task_id_state
               WHERE prefix = ?`,
            )
            .get(prefix) as {
            nextSequence: number;
            committedClusterTaskCount: number;
            lastCommittedTaskId: string | null;
          };

          const active = db
            .prepare(
              `SELECT COUNT(*) AS count FROM distributed_task_id_reservations
               WHERE prefix = ? AND status = 'reserved'`,
            )
            .get(prefix) as { count: number };
          const burned = db
            .prepare(
              `SELECT COUNT(*) AS count FROM distributed_task_id_reservations
               WHERE prefix = ? AND status IN ('aborted', 'expired')`,
            )
            .get(prefix) as { count: number };

          return {
            nextSequence: row.nextSequence,
            committedClusterTaskCount: row.committedClusterTaskCount,
            activeReservationCount: active.count,
            burnedReservationCount: burned.count,
            lastCommittedTaskId: row.lastCommittedTaskId ?? undefined,
          };
        });
      }),
  };
}
