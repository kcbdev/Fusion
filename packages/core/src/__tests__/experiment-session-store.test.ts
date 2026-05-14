import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDatabase, type Database } from "../db.js";
import { ExperimentSessionStore } from "../experiment-session-store.js";

describe("ExperimentSessionStore", () => {
  let db: Database;
  let store: ExperimentSessionStore;

  beforeEach(() => {
    const fusionDir = mkdtempSync(join(tmpdir(), "fn-experiment-test-"));
    db = createDatabase(fusionDir, { inMemory: true });
    db.init();
    store = new ExperimentSessionStore(db);
  });

  it("creates schema tables and indexes and cascades session deletes", () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('experiment_sessions', 'experiment_session_records')")
      .all() as Array<{ name: string }>;
    expect(tables.map((row) => row.name).sort()).toEqual(["experiment_session_records", "experiment_sessions"]);

    const sessionIndexes = db.prepare("PRAGMA index_list(experiment_sessions)").all() as Array<{ name: string }>;
    expect(sessionIndexes.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        "idxExperimentSessionsStatus",
        "idxExperimentSessionsProject",
        "idxExperimentSessionsCreatedAt",
      ]),
    );

    const recordIndexes = db.prepare("PRAGMA index_list(experiment_session_records)").all() as Array<{ name: string }>;
    expect(recordIndexes.map((row) => row.name)).toEqual(
      expect.arrayContaining(["idxExperimentRecordsSessionSegment", "idxExperimentRecordsType"]),
    );

    const session = store.createSession({ name: "S1", metric: { name: "latency", direction: "minimize" } });
    store.appendRecord(session.id, {
      type: "run",
      payload: { primaryMetric: 100, secondaryMetrics: [], status: "pending" },
    });
    expect(store.deleteSession(session.id)).toBe(true);
    const count = db.prepare("SELECT COUNT(*) as c FROM experiment_session_records").get() as { c: number };
    expect(count.c).toBe(0);
  });

  it("supports session CRUD, status/finalized events, and list filters", () => {
    const onStatus = vi.fn();
    const onFinalized = vi.fn();
    store.on("session:status_changed", onStatus);
    store.on("session:finalized", onFinalized);

    const s1 = store.createSession({
      name: "alpha bench",
      projectId: "proj-a",
      metric: { name: "throughput", direction: "maximize" },
      tags: ["perf", "ci"],
    });
    const s2 = store.createSession({
      name: "beta stability",
      projectId: "proj-b",
      status: "finalizing",
      metric: { name: "latency", direction: "minimize" },
      tags: ["stability"],
      workingDir: "apps/api",
    });

    expect(store.getSession(s1.id)?.name).toBe("alpha bench");
    expect(store.listSessions({ projectId: "proj-a" }).map((s) => s.id)).toEqual([s1.id]);
    expect(store.listSessions({ status: "finalizing" }).map((s) => s.id)).toEqual([s2.id]);
    expect(store.listSessions({ tag: "perf" }).map((s) => s.id)).toEqual([s1.id]);
    expect(store.listSessions({ search: "api" }).map((s) => s.id)).toEqual([s2.id]);

    const finalized = store.updateSession(s1.id, { status: "finalized" });
    expect(finalized.finalizedAt).toBeTruthy();
    expect(onStatus).toHaveBeenCalledTimes(1);
    expect(onFinalized).toHaveBeenCalledTimes(1);

    expect(store.deleteSession(s2.id)).toBe(true);
    expect(store.getSession(s2.id)).toBeUndefined();
  });

  it("maintains contiguous seq per session under interleaved appends", () => {
    const a = store.createSession({ name: "A", metric: { name: "m", direction: "maximize" } });
    const b = store.createSession({ name: "B", metric: { name: "m", direction: "maximize" } });

    store.appendRecord(a.id, { type: "run", payload: { primaryMetric: 1, secondaryMetrics: [], status: "pending" } });
    store.appendRecord(b.id, { type: "run", payload: { primaryMetric: 2, secondaryMetrics: [], status: "pending" } });
    store.appendRecord(a.id, { type: "run", payload: { primaryMetric: 3, secondaryMetrics: [], status: "keep" } });
    store.appendRecord(b.id, { type: "run", payload: { primaryMetric: 4, secondaryMetrics: [], status: "discard" } });

    expect(store.listRecords(a.id).map((r) => r.seq)).toEqual([1, 2]);
    expect(store.listRecords(b.id).map((r) => r.seq)).toEqual([1, 2]);
  });

  it("starts new segments and appends config record in new segment", () => {
    const session = store.createSession({ name: "seg", metric: { name: "x", direction: "maximize" } });
    const { session: updated, record } = store.startNewSegment(session.id, {
      metric: { name: "x", direction: "maximize" },
      maxIterations: 20,
    });
    expect(updated.currentSegment).toBe(2);
    expect(record.type).toBe("config");
    expect(record.segment).toBe(2);

    const run = store.appendRecord(session.id, {
      type: "run",
      payload: { primaryMetric: 5, secondaryMetrics: [], status: "pending" },
    });
    expect(run.segment).toBe(2);
  });

  it.each([
    ["config", { metric: { name: "t", direction: "maximize" } }],
    ["run", { primaryMetric: 1, secondaryMetrics: [{ name: "cpu", value: 2 }], status: "keep", durationMs: 12 }],
    ["hook", { hook: "after", exitCode: 0, stdout: "ok" }],
    ["finalize", { keptRunIds: ["r1"], discardedRunIds: ["r2"], summary: "done" }],
  ] as const)("round-trips %s payloads", (type, payload) => {
    const session = store.createSession({ name: "rt", metric: { name: "m", direction: "maximize" } });
    const appended = store.appendRecord(session.id, { type, payload });
    const listed = store.listRecords(session.id, { type });
    expect(listed).toHaveLength(1);
    expect(listed[0]).toEqual(appended);
    expect(store.getRecord(appended.id)?.payload).toEqual(payload);
  });

  it("validates baseline/best run pointers and updates pointers", () => {
    const a = store.createSession({ name: "A", metric: { name: "x", direction: "maximize" } });
    const b = store.createSession({ name: "B", metric: { name: "x", direction: "maximize" } });
    const runA = store.appendRecord(a.id, { type: "run", payload: { primaryMetric: 1, secondaryMetrics: [], status: "keep" } });
    const configA = store.appendRecord(a.id, { type: "config", payload: { metric: { name: "x", direction: "maximize" } } });
    const runB = store.appendRecord(b.id, { type: "run", payload: { primaryMetric: 2, secondaryMetrics: [], status: "keep" } });

    expect(() => store.setBaselineRun(a.id, "missing")).toThrow(/not found/i);
    expect(() => store.setBaselineRun(a.id, configA.id)).toThrow(/not a run/i);
    expect(() => store.setBestRun(a.id, runB.id)).toThrow(/does not belong/i);

    store.setBaselineRun(a.id, runA.id);
    const updated = store.setBestRun(a.id, runA.id);
    expect(updated.baselineRunId).toBe(runA.id);
    expect(updated.bestRunId).toBe(runA.id);
  });

  it("rejects appends for finalized sessions", () => {
    const session = store.createSession({ name: "done", metric: { name: "x", direction: "maximize" } });
    store.updateSession(session.id, { status: "finalized" });

    const onRecord = vi.fn();
    store.on("record:appended", onRecord);
    expect(() =>
      store.appendRecord(session.id, {
        type: "run",
        payload: { primaryMetric: 1, secondaryMetrics: [], status: "pending" },
      }),
    ).toThrow(/Cannot append record/i);
    expect(onRecord).not.toHaveBeenCalled();
  });

  it("updates run payload patch additively", () => {
    const session = store.createSession({ name: "p", metric: { name: "x", direction: "maximize" } });
    const run = store.appendRecord(session.id, {
      type: "run",
      payload: { primaryMetric: 9, secondaryMetrics: [], status: "keep" },
    });

    const updated = store.updateRecordPayload(run.id, { commit: "abc123" });
    expect(updated.payload).toEqual({
      primaryMetric: 9,
      secondaryMetrics: [],
      status: "keep",
      commit: "abc123",
    });
    expect(store.getRecord(run.id)?.payload).toEqual(updated.payload);
  });

  it("recordKept is idempotent", () => {
    const session = store.createSession({ name: "k", metric: { name: "x", direction: "maximize" } });
    const run = store.appendRecord(session.id, {
      type: "run",
      payload: { primaryMetric: 9, secondaryMetrics: [], status: "keep" },
    });
    store.recordKept(session.id, run.id);
    const updated = store.recordKept(session.id, run.id);
    expect(updated.keptRunIds).toEqual([run.id]);
  });
});
