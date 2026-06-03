import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { InteractiveAiSession, InteractiveAiSessionEvent, PlanningQuestion } from "@fusion/core";
import { vi } from "vitest";
import { CeOrchestrator, CE_EVENTS } from "../session/orchestrator.js";
import { CeSessionStore, getCeSessionStore } from "../session/session-store.js";
import { makeHarness, type TestHarness } from "./_harness.js";

/**
 * CHARACTERIZATION TEST — written first (U5 execution note: cover the
 * no-silent-loss invariant before the happy path). Asserts that an interrupted
 * mid-question session auto-saves progress, lands in `interrupted`, emits an
 * observable event, and resumes to the SAME question with full history.
 */

const QUESTION: PlanningQuestion = {
  id: "q1",
  type: "single_select",
  question: "Which direction?",
  options: [
    { id: "a", label: "A" },
    { id: "b", label: "B" },
  ],
};

let h: TestHarness;

beforeEach(() => {
  h = makeHarness();
});

afterEach(() => {
  h.close();
});

/**
 * Session that yields a question on turn 1, then HANGS on the next turn
 * (the answer turn never produces an event) — forcing a turn timeout.
 */
function questionThenHangSession(): InteractiveAiSession {
  let cursor = -1;
  return {
    prompt: vi.fn(async () => {
      cursor++;
    }),
    answer: vi.fn(async () => {
      cursor++;
    }),
    nextEvent: vi.fn(async (): Promise<InteractiveAiSessionEvent> => {
      if (cursor === 0) return { type: "question", data: QUESTION };
      // turn 2+ hangs forever
      return new Promise<InteractiveAiSessionEvent>(() => undefined);
    }),
    dispose: vi.fn(),
  };
}

describe("interrupt + resume (no silent loss)", () => {
  it("auto-saves progress on a turn timeout, marks interrupted, emits an event", async () => {
    const session = questionThenHangSession();
    const orch = new CeOrchestrator({
      ctx: h.ctx,
      createInteractiveAiSession: vi.fn(async () => ({ session })),
      projectRoot: h.projectRoot,
      turnTimeoutMs: 20,
    });

    const started = await orch.start("brainstorm", { openingMessage: "kick off" });
    expect(started.event?.type).toBe("question");
    expect(started.session.status).toBe("awaiting_input");
    expect(started.session.currentQuestion?.id).toBe("q1");

    // Answering triggers the next turn, which hangs → timeout → interrupted.
    const interrupted = await orch.answer(started.session.id, "q1", "a");
    expect(interrupted.session.status).toBe("interrupted");
    // Progress preserved: full history including the question and the answer.
    const history = interrupted.session.conversationHistory;
    expect(history.some((t) => t.text.includes("kick off"))).toBe(true);
    expect(history.some((t) => t.text.includes("question"))).toBe(true);
    expect(history.some((t) => t.text.includes("\"answer\""))).toBe(true);

    // Observable event emitted — never silent loss.
    expect(h.emitted.map((e) => e.event)).toContain(CE_EVENTS.interrupted);
  });

  it("recoverStaleSessions restores an awaiting_input session left by a crash, and resume returns the same question with full history", () => {
    // Simulate a session persisted mid-question whose process died: status is
    // awaiting_input with currentQuestion set, lastActivity well past the stale
    // band (interval-relative).
    const store = new CeSessionStore(h.db);
    const created = store.create({ stage: "brainstorm", turnIntervalMs: 1000 });
    store.appendHistory(created.id, { role: "user", text: "kick off", at: new Date().toISOString() });
    store.appendHistory(created.id, { role: "agent", text: JSON.stringify({ question: QUESTION }), at: new Date().toISOString() });
    store.update(created.id, {
      status: "awaiting_input",
      currentQuestion: QUESTION,
      // 10× interval old → unambiguously stale.
      lastActivityAt: Date.now() - 10_000,
    });

    const recovered = store.recoverStaleSessions();
    expect(recovered).toContain(created.id);

    const after = store.get(created.id)!;
    // Awaiting-input session with a question stays resumable, not dropped.
    expect(after.status).toBe("awaiting_input");
    expect(after.currentQuestion?.id).toBe("q1");

    // Resume via the orchestrator returns to the same question + full history.
    const orch = new CeOrchestrator({ ctx: h.ctx, createInteractiveAiSession: vi.fn(), projectRoot: h.projectRoot });
    const resumed = orch.resume(created.id);
    expect(resumed.session.status).toBe("awaiting_input");
    expect(resumed.session.currentQuestion?.id).toBe("q1");
    expect(resumed.session.conversationHistory).toHaveLength(2);
  });

  it("a crash with no pending question is marked interrupted (progress preserved), not silently dropped", () => {
    const store = getCeSessionStore(h.ctx);
    const created = store.create({ stage: "brainstorm", turnIntervalMs: 1000 });
    store.appendHistory(created.id, { role: "user", text: "kick off", at: new Date().toISOString() });
    store.update(created.id, { status: "active", lastActivityAt: Date.now() - 10_000 });

    store.recoverStaleSessions();
    const after = store.get(created.id)!;
    expect(after.status).toBe("interrupted");
    expect(after.error).toMatch(/progress preserved/i);
    expect(after.conversationHistory).toHaveLength(1);
  });
});
