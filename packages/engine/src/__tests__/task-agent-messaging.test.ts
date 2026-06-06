// Per-task agent messaging with parked-agent queueing (plan U9, R10).
//
// A user message addressed to a specific agent within a task is delivered on
// that agent's next reasoning cycle; if the agent is idle/parked the message
// queues (persisted) and is injected when the task next activates in that
// agent's column. This builds on the existing steering-comment channel: an
// addressed message is a steering comment carrying `targetAgentId` + a
// `deliveryState` lifecycle, so it is injected ONLY into its target agent's
// context (never another agent's) and can be queued while the agent is parked.
//
// Two seams carry delivery:
//   (1) dispatch context — `buildExecutionPrompt(..., effectiveAgentId)` folds
//       pending messages for that agent into the steering section. Exercised
//       directly here (the deterministic predicate the live listener mirrors).
//   (2) live session — the executor's task:updated listener injects new pending
//       messages for the running agent via session.steer(). Its filter is the
//       same predicate; the store-level lifecycle is asserted end-to-end.

import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildExecutionPrompt } from "../executor.js";
import { TaskStore, type TaskDetail } from "@fusion/core";

function makeTmpDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function detailWith(steeringComments: TaskDetail["steeringComments"]): TaskDetail {
  return {
    id: "FN-001",
    title: "Test Task",
    description: "A test task",
    column: "in-progress",
    dependencies: [],
    steps: [],
    currentStep: 0,
    log: [],
    prompt: "# test\n## Steps\n### Step 0: Preflight\n- [ ] check",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    steeringComments,
  } as TaskDetail;
}

// ─────────────────────────────────────────────────────────────────────────────
// (1) Dispatch-context filtering — buildExecutionPrompt(..., effectiveAgentId)
// ─────────────────────────────────────────────────────────────────────────────

describe("buildExecutionPrompt — per-agent message injection (U9)", () => {
  it("injects a pending message addressed to THIS dispatch's agent", () => {
    const detail = detailWith([
      { id: "m1", text: "please refactor the parser", createdAt: new Date().toISOString(), author: "user", targetAgentId: "agent-exec", deliveryState: "pending" },
    ]);
    const result = buildExecutionPrompt(detail, "/project", undefined, undefined, undefined, undefined, "agent-exec");
    expect(result).toContain("## Steering Comments");
    expect(result).toContain("please refactor the parser");
  });

  it("does NOT inject a message addressed to a DIFFERENT agent", () => {
    const detail = detailWith([
      { id: "m1", text: "message for the reviewer", createdAt: new Date().toISOString(), author: "user", targetAgentId: "agent-reviewer", deliveryState: "pending" },
    ]);
    // Dispatching as the executor: the reviewer-addressed message stays queued.
    const result = buildExecutionPrompt(detail, "/project", undefined, undefined, undefined, undefined, "agent-exec");
    expect(result).not.toContain("message for the reviewer");
    expect(result).not.toContain("## Steering Comments");
  });

  it("does NOT inject an already-delivered / cancelled message", () => {
    const detail = detailWith([
      { id: "m1", text: "already delivered", createdAt: new Date().toISOString(), author: "user", targetAgentId: "agent-exec", deliveryState: "delivered" },
      { id: "m2", text: "was cancelled", createdAt: new Date().toISOString(), author: "user", targetAgentId: "agent-exec", deliveryState: "cancelled" },
    ]);
    const result = buildExecutionPrompt(detail, "/project", undefined, undefined, undefined, undefined, "agent-exec");
    expect(result).not.toContain("already delivered");
    expect(result).not.toContain("was cancelled");
  });

  it("always injects untargeted (legacy broadcast) steering regardless of agent", () => {
    const detail = detailWith([
      { id: "m1", text: "legacy broadcast steering", createdAt: new Date().toISOString(), author: "user" },
    ]);
    // No effective agent passed → addressed messages would be excluded, but
    // untargeted steering is always present (byte-identical legacy behavior).
    const result = buildExecutionPrompt(detail, "/project");
    expect(result).toContain("legacy broadcast steering");
  });

  it("keeps addressed messages queued when no effective agent resolves", () => {
    const detail = detailWith([
      { id: "m1", text: "addressed but no dispatch agent", createdAt: new Date().toISOString(), author: "user", targetAgentId: "agent-exec", deliveryState: "pending" },
    ]);
    const result = buildExecutionPrompt(detail, "/project");
    expect(result).not.toContain("addressed but no dispatch agent");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (2) End-to-end lifecycle over a real TaskStore + dispatch builder
// ─────────────────────────────────────────────────────────────────────────────

describe("task agent messaging — parked queueing lifecycle (U9)", () => {
  let rootDir: string;
  let globalDir: string;
  let store: TaskStore;

  beforeEach(async () => {
    rootDir = makeTmpDir("kb-u9-");
    globalDir = makeTmpDir("kb-u9-global-");
    store = new TaskStore(rootDir, globalDir, { inMemoryDb: true });
    await store.init();
  });

  afterEach(async () => {
    store.close();
    await rm(rootDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    await rm(globalDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it("a parked agent's message persists pending, then injects + marks delivered on activation", async () => {
    const task = await store.createTask({ description: "parked target" });
    await store.queueAgentMessage(task.id, "agent-exec", "do this when you run", "user");

    // Parked: still pending.
    expect(await store.listAgentMessages(task.id, { state: "pending" })).toHaveLength(1);

    // Activation in the executor's column: dispatch builds the prompt for the
    // executor agent → the message is injected, then marked delivered.
    const detail = await store.getTask(task.id) as TaskDetail;
    const prompt = buildExecutionPrompt(detail, rootDir, undefined, undefined, undefined, undefined, "agent-exec");
    expect(prompt).toContain("do this when you run");

    const delivered = await store.markAgentMessagesDelivered(task.id, "agent-exec");
    expect(delivered).toHaveLength(1);
    expect(await store.listAgentMessages(task.id, { state: "delivered" })).toHaveLength(1);
    expect(await store.listAgentMessages(task.id, { state: "pending" })).toHaveLength(0);
  });

  it("a message addressed to agent B is never injected into agent A's dispatch", async () => {
    const task = await store.createTask({ description: "cross-agent" });
    await store.queueAgentMessage(task.id, "agent-b", "for B only", "user");

    const detail = await store.getTask(task.id) as TaskDetail;
    // Agent A dispatches: B's message is excluded and stays pending.
    const promptA = buildExecutionPrompt(detail, rootDir, undefined, undefined, undefined, undefined, "agent-a");
    expect(promptA).not.toContain("for B only");
    // A marking delivered must not touch B's message.
    expect(await store.markAgentMessagesDelivered(task.id, "agent-a")).toHaveLength(0);
    expect(await store.listAgentMessages(task.id, { state: "pending", targetAgentId: "agent-b" })).toHaveLength(1);
  });

  it("a message for a passed column stays pending; returning to that column delivers it", async () => {
    const task = await store.createTask({ description: "backward move" });
    // Message addressed to the Lead, but the task has already moved past the
    // Lead's column to the executor.
    await store.queueAgentMessage(task.id, "agent-lead", "lead, reconsider the plan", "user");

    // Executor dispatch: lead-addressed message excluded, stays pending.
    let detail = await store.getTask(task.id) as TaskDetail;
    const execPrompt = buildExecutionPrompt(detail, rootDir, undefined, undefined, undefined, undefined, "agent-exec");
    expect(execPrompt).not.toContain("lead, reconsider the plan");
    expect(await store.markAgentMessagesDelivered(task.id, "agent-exec")).toHaveLength(0);
    expect(await store.listAgentMessages(task.id, { state: "pending" })).toHaveLength(1);

    // Reviewer moves the task back to the Lead's column → Lead dispatches and
    // the queued message is finally injected and delivered.
    detail = await store.getTask(task.id) as TaskDetail;
    const leadPrompt = buildExecutionPrompt(detail, rootDir, undefined, undefined, undefined, undefined, "agent-lead");
    expect(leadPrompt).toContain("lead, reconsider the plan");
    expect(await store.markAgentMessagesDelivered(task.id, "agent-lead")).toHaveLength(1);
    expect(await store.listAgentMessages(task.id, { state: "delivered" })).toHaveLength(1);
  });

  it("a cancelled message is never delivered even when its agent dispatches", async () => {
    const task = await store.createTask({ description: "cancel" });
    const { messageId } = await store.queueAgentMessage(task.id, "agent-exec", "ignore me", "user");
    await store.cancelQueuedMessage(task.id, messageId);

    const detail = await store.getTask(task.id) as TaskDetail;
    const prompt = buildExecutionPrompt(detail, rootDir, undefined, undefined, undefined, undefined, "agent-exec");
    expect(prompt).not.toContain("ignore me");
    expect(await store.markAgentMessagesDelivered(task.id, "agent-exec")).toHaveLength(0);
    expect(await store.listAgentMessages(task.id, { state: "cancelled" })).toHaveLength(1);
  });

  it("archiving a task with a pending message discards it with a task-log note", async () => {
    const task = await store.createTask({ description: "archive" });
    await store.queueAgentMessage(task.id, "agent-exec", "never delivered", "user");

    await store.moveTask(task.id, "todo");
    await store.moveTask(task.id, "in-progress");
    await store.moveTask(task.id, "done");
    const archived = await store.archiveTask(task.id, { cleanup: false });

    expect(await store.listAgentMessages(task.id, { state: "discarded" })).toHaveLength(1);
    expect(archived.log.some((e) => e.action.includes("Discarded") && e.action.includes("queued message"))).toBe(true);
  });

  it("pending messages survive a store reopen", async () => {
    const task = await store.createTask({ description: "persist" });
    await store.queueAgentMessage(task.id, "agent-exec", "still queued", "user");

    store.close();
    store = new TaskStore(rootDir, globalDir);
    await store.init();

    const pending = await store.listAgentMessages(task.id, { state: "pending" });
    expect(pending).toHaveLength(1);
    expect(pending[0].text).toBe("still queued");
  });
});
