import { describe, expect, it, vi } from "vitest";
import type { TaskDetail, WorkflowIrNode } from "@fusion/core";

import { createDefaultNodeHandlers } from "../workflow-node-handlers.js";

const task = { id: "FN-5767" } as TaskDetail;
const node = (kind: WorkflowIrNode["kind"], seam?: string): WorkflowIrNode => ({ id: kind, kind, config: seam ? { seam } : {} });

describe("workflow node handlers", () => {
  it("dispatches prompt node to matching seam", async () => {
    const seams = {
      execute: vi.fn(async () => ({ outcome: "success" as const })),
      review: vi.fn(async () => ({ outcome: "success" as const })),
      merge: vi.fn(async () => ({ outcome: "success" as const })),
      schedule: vi.fn(async () => ({ outcome: "success" as const })),
    };
    const handlers = createDefaultNodeHandlers(seams);
    await handlers.prompt(node("prompt", "review"), { task, settings: undefined, context: {} });
    expect(seams.review).toHaveBeenCalledOnce();
    expect(seams.execute).not.toHaveBeenCalled();
  });

  it("dispatches script node to matching seam", async () => {
    const seams = {
      execute: vi.fn(async () => ({ outcome: "success" as const })),
      review: vi.fn(async () => ({ outcome: "success" as const })),
      merge: vi.fn(async () => ({ outcome: "success" as const })),
      schedule: vi.fn(async () => ({ outcome: "success" as const })),
    };
    const handlers = createDefaultNodeHandlers(seams);
    await handlers.script(node("script", "execute"), { task, settings: undefined, context: {} });
    expect(seams.execute).toHaveBeenCalledOnce();
  });

  it("gate returns failure when expected context value does not match", async () => {
    const handlers = createDefaultNodeHandlers({
      execute: async () => ({ outcome: "success" }),
      review: async () => ({ outcome: "success" }),
      merge: async () => ({ outcome: "success" }),
      schedule: async () => ({ outcome: "success" }),
    });

    const result = await handlers.gate(
      { id: "g", kind: "gate", config: { contextKey: "phase", expect: "merge" } },
      { task, settings: undefined, context: { phase: "review" } },
    );

    expect(result).toEqual({ outcome: "failure", value: "gate-mismatch" });
  });
});
