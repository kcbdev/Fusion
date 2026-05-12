import { describe, expect, it } from "vitest";
import { Database } from "../db.js";
import { createDistributedTaskIdAllocator, DistributedTaskIdError, reconcileTaskIdState } from "../distributed-task-id.js";

describe("distributed-task-id allocator", () => {
  const createAllocator = () => {
    const db = new Database("/tmp/fusion-test", { inMemory: true });
    db.init();
    return { db, allocator: createDistributedTaskIdAllocator(db) };
  };

  it("returns unique sequential IDs across concurrent reservations", async () => {
    const { allocator } = createAllocator();
    const reservations = await Promise.all(
      Array.from({ length: 10 }, () => allocator.reserveDistributedTaskId({ prefix: "fn", nodeId: "node-a" })),
    );
    const ids = reservations.map((r) => r.taskId);
    expect(new Set(ids).size).toBe(10);
    expect(ids[0]).toBe("FN-001");
    expect(ids[9]).toBe("FN-010");
  });

  it("commit increments committedClusterTaskCount by one", async () => {
    const { allocator } = createAllocator();
    const reservation = await allocator.reserveDistributedTaskId({ prefix: "FN", nodeId: "node-a" });
    const committed = await allocator.commitDistributedTaskIdReservation({
      reservationId: reservation.reservationId,
      nodeId: "node-a",
    });
    expect(committed.committedClusterTaskCount).toBe(reservation.committedClusterTaskCount + 1);
  });

  it("abort burns the sequence and does not increment committed count", async () => {
    const { allocator } = createAllocator();
    const reservation = await allocator.reserveDistributedTaskId({ prefix: "FN", nodeId: "node-a" });
    const aborted = await allocator.abortDistributedTaskIdReservation({
      reservationId: reservation.reservationId,
      nodeId: "node-a",
      reason: "failed-create",
    });
    expect(aborted.committedClusterTaskCount).toBe(reservation.committedClusterTaskCount);
    const state = await allocator.getDistributedTaskIdState({ prefix: "FN" });
    expect(state.burnedReservationCount).toBe(1);
  });

  it("expired reservations cannot be committed and count as burned", async () => {
    const { allocator } = createAllocator();
    const reservation = await allocator.reserveDistributedTaskId({
      prefix: "FN",
      nodeId: "node-a",
      ttlMs: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await expect(
      allocator.commitDistributedTaskIdReservation({ reservationId: reservation.reservationId, nodeId: "node-a" }),
    ).rejects.toBeInstanceOf(DistributedTaskIdError);

    const state = await allocator.getDistributedTaskIdState({ prefix: "FN" });
    expect(state.burnedReservationCount).toBe(1);
    expect(state.committedClusterTaskCount).toBe(0);
  });

  it("seeds nextSequence past existing tasks for the configured prefix", async () => {
    // Regression: FN-3450 wired the dashboard task-create route to the
    // distributed allocator. On databases whose tasks were originally
    // allocated through TaskStore.allocateId() (config.nextId), the first
    // mesh-routed reservation used to restart at 1 and produce FN-001 even
    // when FN-3700 already existed. The allocator must now resume past any
    // existing task ID for the prefix.
    const db = new Database("/tmp/fusion-test", { inMemory: true });
    db.init();
    db.prepare("UPDATE config SET nextId = 3701, settings = ? WHERE id = 1").run(
      JSON.stringify({ taskPrefix: "FN" }),
    );
    db.prepare(
      "INSERT INTO tasks (id, description, \"column\", createdAt, updatedAt) VALUES (?, '', 'todo', ?, ?)",
    ).run("FN-3700", new Date().toISOString(), new Date().toISOString());
    const allocator = createDistributedTaskIdAllocator(db);

    const reservation = await allocator.reserveDistributedTaskId({ prefix: "FN", nodeId: "node-a" });
    expect(reservation.taskId).toBe("FN-3701");

    const state = await allocator.getDistributedTaskIdState({ prefix: "FN" });
    expect(state.nextSequence).toBe(3702);
  });

  it("reconciles stale state rows past live tasks, archived tasks, and reservations", () => {
    const db = new Database("/tmp/fusion-test", { inMemory: true });
    db.init();
    const now = new Date().toISOString();

    db.prepare(
      "INSERT INTO tasks (id, description, \"column\", createdAt, updatedAt) VALUES (?, '', 'todo', ?, ?)",
    ).run("FN-003", now, now);
    db.prepare(
      "INSERT INTO archivedTasks (id, data, archivedAt) VALUES (?, ?, ?)",
    ).run("FN-005", JSON.stringify({ id: "FN-005" }), now);
    db.prepare(
      "INSERT INTO distributed_task_id_state (prefix, nextSequence, committedClusterTaskCount, lastCommittedTaskId, updatedAt) VALUES (?, ?, ?, ?, ?)",
    ).run("FN", 2, 1, "FN-001", now);
    db.prepare(
      `INSERT INTO distributed_task_id_reservations (
        reservationId, prefix, nodeId, sequence, taskId, status, reason, expiresAt, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, 'reserved', NULL, ?, ?, ?)`,
    ).run("res-7", "FN", "node-a", 7, "FN-007", new Date(Date.now() + 60_000).toISOString(), now, now);

    const reconciled = reconcileTaskIdState(db);
    expect(reconciled).toContain("FN");

    const state = db.prepare("SELECT nextSequence FROM distributed_task_id_state WHERE prefix = ?").get("FN") as { nextSequence: number };
    expect(state.nextSequence).toBe(8);
  });

  it("skips stale overlapping nextSequence values and reserves the next free id", async () => {
    const db = new Database("/tmp/fusion-test", { inMemory: true });
    db.init();
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO tasks (id, description, \"column\", createdAt, updatedAt) VALUES (?, '', 'todo', ?, ?)",
    ).run("FN-002", now, now);
    db.prepare(
      "INSERT INTO distributed_task_id_state (prefix, nextSequence, committedClusterTaskCount, lastCommittedTaskId, updatedAt) VALUES (?, ?, ?, ?, ?)",
    ).run("FN", 2, 1, "FN-001", now);

    const allocator = createDistributedTaskIdAllocator(db);
    const reservation = await allocator.reserveDistributedTaskId({ prefix: "FN", nodeId: "node-a" });

    expect(reservation.taskId).toBe("FN-003");
    expect(reservation.sequence).toBe(3);

    const state = await allocator.getDistributedTaskIdState({ prefix: "FN" });
    expect(state.nextSequence).toBe(4);
    expect(state.committedClusterTaskCount).toBe(1);
  });

  it("reconciles stale reservation sequences before allocating a new reservation", async () => {
    const db = new Database("/tmp/fusion-test", { inMemory: true });
    db.init();
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO distributed_task_id_state (prefix, nextSequence, committedClusterTaskCount, lastCommittedTaskId, updatedAt) VALUES (?, ?, ?, ?, ?)",
    ).run("FN", 2, 1, "FN-001", now);
    db.prepare(
      `INSERT INTO distributed_task_id_reservations (
        reservationId, prefix, nodeId, sequence, taskId, status, reason, expiresAt, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, 'reserved', NULL, ?, ?, ?)`,
    ).run("res-2", "FN", "node-a", 2, "FN-002", new Date(Date.now() + 60_000).toISOString(), now, now);

    const allocator = createDistributedTaskIdAllocator(db);
    const reservation = await allocator.reserveDistributedTaskId({ prefix: "FN", nodeId: "node-b" });

    expect(reservation.taskId).toBe("FN-003");
    expect(reservation.sequence).toBe(3);
  });

  it("state reports committed count independently from nextSequence", async () => {
    const { allocator } = createAllocator();
    const first = await allocator.reserveDistributedTaskId({ prefix: "FN", nodeId: "node-a" });
    await allocator.abortDistributedTaskIdReservation({ reservationId: first.reservationId, nodeId: "node-a", reason: "abort" });

    const second = await allocator.reserveDistributedTaskId({ prefix: "FN", nodeId: "node-a" });
    await allocator.commitDistributedTaskIdReservation({ reservationId: second.reservationId, nodeId: "node-a" });

    const state = await allocator.getDistributedTaskIdState({ prefix: "FN" });
    expect(state.nextSequence).toBe(3);
    expect(state.committedClusterTaskCount).toBe(1);
  });
});
