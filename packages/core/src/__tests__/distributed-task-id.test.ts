import { describe, expect, it } from "vitest";
import { Database } from "../db.js";
import { createDistributedTaskIdAllocator, DistributedTaskIdError } from "../distributed-task-id.js";

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
