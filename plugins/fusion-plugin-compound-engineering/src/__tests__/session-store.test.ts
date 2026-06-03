import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CeSessionStore, STALE_INTERVAL_MULTIPLE } from "../session/session-store.js";
import { ensureCeSchema } from "../schema.js";
import { makeHarness, type TestHarness } from "./_harness.js";

let h: TestHarness;
beforeEach(() => {
  h = makeHarness();
});
afterEach(() => {
  h.close();
});

describe("ensureCeSchema", () => {
  it("is idempotent (safe to run repeatedly)", () => {
    ensureCeSchema(h.db);
    ensureCeSchema(h.db);
    const cols = h.db.prepare("PRAGMA table_info(ce_sessions)").all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "id",
        "stage",
        "status",
        "currentQuestion",
        "conversationHistory",
        "projectId",
        "lastActivityAt",
      ]),
    );
  });
});

describe("CeSessionStore CRUD + JSON round-trip", () => {
  it("creates, reads back, and round-trips JSON fields", () => {
    const store = new CeSessionStore(h.db);
    const created = store.create({ stage: "brainstorm", projectId: "p1" });
    expect(created.status).toBe("launching");

    store.update(created.id, {
      currentQuestion: { id: "q", type: "confirm", question: "ok?" },
      status: "awaiting_input",
    });
    store.appendHistory(created.id, { role: "user", text: "hi", at: "2026-06-02T00:00:00Z" });

    const read = store.get(created.id)!;
    expect(read.currentQuestion?.id).toBe("q");
    expect(read.conversationHistory).toHaveLength(1);
    expect(read.status).toBe("awaiting_input");
    expect(read.projectId).toBe("p1");
  });
});

describe("interval-relative staleness (FN-4172 rubric)", () => {
  it("does NOT misclassify a healthy-but-slow session as stale", () => {
    const store = new CeSessionStore(h.db);
    const s = store.create({ stage: "brainstorm", turnIntervalMs: 1000 });
    store.update(s.id, { status: "active" });

    const now = Date.now();
    // 2.5× the interval old: slow, but within the 3× band → NOT stale.
    const slow = store.update(s.id, { status: "active", lastActivityAt: now - 2_500 })!;
    expect(STALE_INTERVAL_MULTIPLE).toBe(3);
    expect(store.isStale(slow, now)).toBe(false);

    // 4× the interval old → stale.
    const stalled = store.update(s.id, { status: "active", lastActivityAt: now - 4_000 })!;
    expect(store.isStale(stalled, now)).toBe(true);
  });

  it("never flags terminal sessions as stale regardless of age", () => {
    const store = new CeSessionStore(h.db);
    const s = store.create({ stage: "brainstorm", turnIntervalMs: 1000 });
    const completed = store.update(s.id, { status: "completed", lastActivityAt: Date.now() - 1_000_000 })!;
    expect(store.isStale(completed)).toBe(false);
  });
});
