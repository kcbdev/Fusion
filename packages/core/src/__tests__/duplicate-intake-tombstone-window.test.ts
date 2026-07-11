import { afterEach, beforeEach, describe, expect, it, vi, beforeAll, afterAll } from "vitest";

import { TombstonedTaskResurrectionError } from "../store.js";
import { createSharedTaskStoreTestHarness } from "./store-test-helpers.js";

describe("FN-5233 tombstone sticky-window duplicate intake", () => {
  const harness = createSharedTaskStoreTestHarness();

  beforeAll(harness.beforeAll);
  afterAll(harness.afterAll);

  beforeEach(async () => {
    await harness.beforeEach();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await harness.afterEach();
  });

  it("refuses near-duplicate intake against recent tombstone and records intake:resurrection-blocked", async () => {
    const store = harness.store();
    await store.updateSettings({ tombstoneStickyWindowDays: 7 });

    const original = await store.createTask({
      title: "Memory leak in merge worker",
      description: "Fix memory leak in merge worker when queue is drained",
      source: { sourceType: "unknown", sourceAgentId: "agent-1" },
    });
    await store.deleteTask(original.id);

    await expect(store.createTask({
      title: "Memory leak in merge worker",
      description: "Fix memory leak in merge worker when queue is drained",
      source: { sourceType: "unknown", sourceAgentId: "agent-1" },
    })).rejects.toBeInstanceOf(TombstonedTaskResurrectionError);

    const events = (store as any).db.prepare(
      "SELECT mutationType FROM runAuditEvents WHERE mutationType = 'intake:resurrection-blocked'"
    ).all() as Array<{ mutationType: string }>;
    expect(events).toHaveLength(1);
  });

  it("allows intake when sticky window is disabled", async () => {
    const store = harness.store();
    await store.updateSettings({ tombstoneStickyWindowDays: 0 });

    const original = await store.createTask({
      title: "A",
      description: "same text",
      source: { sourceType: "unknown", sourceAgentId: "agent-2" },
    });
    await store.deleteTask(original.id);

    await expect(store.createTask({
      title: "A",
      description: "same text",
      source: { sourceType: "unknown", sourceAgentId: "agent-2" },
    })).resolves.toMatchObject({ id: expect.any(String) });
  });

  it("ignores tombstones outside sticky window", async () => {
    vi.useFakeTimers();
    const oldNow = new Date("2026-01-01T00:00:00.000Z");
    vi.setSystemTime(oldNow);
    const store = harness.store();
    await store.updateSettings({ tombstoneStickyWindowDays: 7 });
    const original = await store.createTask({
      title: "Old tombstone",
      description: "same text",
      source: { sourceType: "unknown", sourceAgentId: "agent-2b" },
    });
    await store.deleteTask(original.id);

    vi.setSystemTime(new Date("2026-01-12T00:00:00.000Z"));
    await expect(store.createTask({
      title: "Old tombstone",
      description: "same text",
      source: { sourceType: "unknown", sourceAgentId: "agent-2b" },
    })).resolves.toMatchObject({ id: expect.any(String) });
  });

  it("allows intake when tombstoned match has allowResurrection unlock", async () => {
    const store = harness.store();
    await store.updateSettings({ tombstoneStickyWindowDays: 7 });

    const original = await store.createTask({
      title: "Refactor parser",
      description: "Refactor parser for streaming input",
      source: { sourceType: "unknown", sourceAgentId: "agent-3" },
    });
    await store.deleteTask(original.id, { allowResurrection: true });

    await expect(store.createTask({
      title: "Refactor parser",
      description: "Refactor parser for streaming input",
      source: { sourceType: "unknown", sourceAgentId: "agent-3" },
    })).resolves.toMatchObject({ id: expect.any(String) });
  });

  it("FN-7658: flags (does not auto-archive) live-task duplicates by default", async () => {
    const store = harness.store();
    const live = await store.createTask({
      title: "Live dup",
      description: "duplicate text",
      source: { sourceType: "unknown", sourceAgentId: "agent-4" },
    });
    const dup = await store.createTask({
      title: "Live dup",
      description: "duplicate text",
      source: { sourceType: "unknown", sourceAgentId: "agent-4" },
    });
    expect(dup.column).not.toBe("archived");
    expect(dup.sourceMetadata?.nearDuplicateOf).toBe(live.id);
    const events = (store as any).db.prepare("SELECT mutationType FROM runAuditEvents WHERE mutationType = 'intake:resurrection-blocked'").all() as Array<{ mutationType: string }>;
    expect(events).toHaveLength(0);
    expect(live.id).not.toBe(dup.id);
  });

  it("FN-7658: keeps legacy auto-archive behavior when autoArchiveDuplicateTasksEnabled is true", async () => {
    const store = harness.store();
    await store.updateSettings({ autoArchiveDuplicateTasksEnabled: true });
    const live = await store.createTask({
      title: "Live dup enabled",
      description: "duplicate text enabled",
      source: { sourceType: "unknown", sourceAgentId: "agent-4b" },
    });
    const dup = await store.createTask({
      title: "Live dup enabled",
      description: "duplicate text enabled",
      source: { sourceType: "unknown", sourceAgentId: "agent-4b" },
    });
    expect(dup.column).toBe("archived");
    expect(live.id).not.toBe(dup.id);
  });

  it("FN-7658: tombstone-resurrection blocking still fires when autoArchiveDuplicateTasksEnabled is false", async () => {
    const store = harness.store();
    await store.updateSettings({ tombstoneStickyWindowDays: 7, autoArchiveDuplicateTasksEnabled: false });

    const original = await store.createTask({
      title: "Resurrection guard stays on",
      description: "Fix resurrection guard regardless of duplicate archive setting",
      source: { sourceType: "unknown", sourceAgentId: "agent-4c" },
    });
    await store.deleteTask(original.id);

    await expect(store.createTask({
      title: "Resurrection guard stays on",
      description: "Fix resurrection guard regardless of duplicate archive setting",
      source: { sourceType: "unknown", sourceAgentId: "agent-4c" },
    })).rejects.toBeInstanceOf(TombstonedTaskResurrectionError);
  });

  it("fails open when tombstone widening query errors", async () => {
    const store = harness.store();
    const db = (store as any).db;
    const originalPrepare = db.prepare.bind(db);
    db.prepare = (sql: string) => {
      if (sql.includes("deletedAt IS NOT NULL") && sql.includes("sourceAgentId")) {
        throw new Error("synthetic tombstone query failure");
      }
      return originalPrepare(sql);
    };

    await expect(store.createTask({
      title: "Fallback path",
      description: "create despite widening failure",
      source: { sourceType: "unknown", sourceAgentId: "agent-5" },
    })).resolves.toMatchObject({ id: expect.any(String) });

    db.prepare = originalPrepare;
  });
});
