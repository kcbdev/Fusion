// @vitest-environment node

import { describe, it, expect, vi } from "vitest";
import express from "express";
import type { TaskStore } from "@fusion/core";
import { createApiRoutes } from "../../routes.js";
import { request as REQUEST } from "../../test-request.js";

describe("task workflow unpause route", () => {
  it("clears userPaused latch for todo user-paused tasks", async () => {
    let taskState = {
      id: "FN-001",
      description: "todo parked task",
      column: "todo",
      dependencies: [],
      steps: [],
      currentStep: 0,
      log: [],
      createdAt: "2026-05-15T00:00:00.000Z",
      updatedAt: "2026-05-15T00:00:00.000Z",
      paused: undefined,
      userPaused: true,
    } as any;

    const store: TaskStore = {
      getRootDir: vi.fn(() => process.cwd()),
      getTask: vi.fn(async () => taskState),
      pauseTask: vi.fn(async (_id: string, paused: boolean) => {
        taskState = {
          ...taskState,
          paused: paused ? true : undefined,
          userPaused: paused ? taskState.userPaused : undefined,
        };
        return taskState;
      }),
    } as unknown as TaskStore;

    const app = express();
    app.use(express.json());
    app.use("/api", createApiRoutes(store));

    const res = await REQUEST(app, "POST", "/api/tasks/FN-001/unpause", JSON.stringify({}), {
      "content-type": "application/json",
    });

    expect(res.status).toBe(200);
    expect(taskState.userPaused).toBeUndefined();
    expect(taskState.userPaused === true).toBe(false);
    expect(store.pauseTask).toHaveBeenCalledWith("FN-001", false);
  });
});
