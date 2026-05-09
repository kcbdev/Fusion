// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import express from "express";

import { createPluginRouter } from "../plugin-routes.js";
import { get as performGet, request as performRequest } from "../test-request.js";

describe("createPluginRouter wiring under /api/plugins", () => {
  function buildApp() {
    const enablePlugin = vi.fn(async (id: string) => ({ id, enabled: true }));
    const pluginStore = {
      listPlugins: vi.fn(async () => [{ id: "test-plugin", name: "Test Plugin", enabled: false }]),
      getPlugin: vi.fn(async (id: string) => ({ id, settings: {}, enabled: false, manifest: { id, name: id, version: "1.0.0", description: "" } })),
      enablePlugin,
      disablePlugin: vi.fn(),
      registerPlugin: vi.fn(),
      unregisterPlugin: vi.fn(),
      updatePluginSettings: vi.fn(),
      updatePluginState: vi.fn(),
    } as any;

    const taskStore = {
      listTasks: vi.fn(async () => []),
    } as any;

    const helloHandler = vi.fn(async () => ({ ok: true }));
    const collidingEnableHandler = vi.fn(async () => ({ pluginEnable: true }));
    const taskStoreHandler = vi.fn(async (_req: unknown, ctx: { taskStore: { listTasks: () => Promise<unknown[]> } }) => {
      await ctx.taskStore.listTasks();
      return { usedTaskStore: true };
    });

    const pluginLoader = {
      getPlugin: vi.fn((id: string) => {
        if (id === "test-plugin" || id === "collision-plugin") {
          return { manifest: { id } };
        }
        return undefined;
      }),
      createRouteContext: vi.fn(async (_id: string, overrides: { taskStore: unknown; settings: Record<string, unknown> }) => ({
        pluginId: "test-plugin",
        taskStore: overrides.taskStore,
        settings: overrides.settings,
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        emitEvent: vi.fn(),
      })),
      loadPlugin: vi.fn(),
      stopPlugin: vi.fn(),
    } as any;

    const pluginRunner = {
      getPluginRoutes: vi.fn(() => [
        { pluginId: "test-plugin", route: { method: "GET", path: "/hello", handler: helloHandler } },
        { pluginId: "test-plugin", route: { method: "GET", path: "/use-task-store", handler: taskStoreHandler } },
        { pluginId: "collision-plugin", route: { method: "POST", path: "/enable", handler: collidingEnableHandler } },
      ]),
    } as any;

    const app = express();
    app.use(express.json());
    app.use("/api/plugins", createPluginRouter(pluginStore, pluginLoader, pluginRunner, taskStore));
    app.use((_req, res) => res.status(404).json({ error: "Not found" }));

    return {
      app,
      pluginStore,
      taskStore,
      handlers: { helloHandler, collidingEnableHandler, taskStoreHandler },
    };
  }

  it("resolves plugin-defined dynamic GET route", async () => {
    const { app } = buildApp();
    const res = await performGet(app, "/api/plugins/test-plugin/hello");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("keeps management routes working alongside dynamic routes", async () => {
    const { app, pluginStore } = buildApp();

    const list = await performGet(app, "/api/plugins/");
    expect(list.status).toBe(200);
    expect(pluginStore.listPlugins).toHaveBeenCalled();

    const enable = await performRequest(app, "POST", "/api/plugins/test-plugin/enable");
    expect(enable.status).toBe(200);
    expect(pluginStore.enablePlugin).toHaveBeenCalledWith("test-plugin");
  });

  it("prioritizes management /:id/enable over plugin-defined /enable route collisions", async () => {
    const { app, pluginStore, handlers } = buildApp();

    const res = await performRequest(app, "POST", "/api/plugins/collision-plugin/enable");
    expect(res.status).toBe(200);
    expect(pluginStore.enablePlugin).toHaveBeenCalledWith("collision-plugin");
    expect(handlers.collidingEnableHandler).not.toHaveBeenCalled();
  });

  it.each([
    ["GET", "/api/plugins/does-not-exist/anything", 404],
    ["GET", "/api/plugins/missing/hello", 404],
  ])("returns %i for unknown plugin IDs (%s %s)", async (method, path, expectedStatus) => {
    const { app } = buildApp();
    const res = await performRequest(app, method as "GET", path);
    expect(res.status).toBe(expectedStatus);
  });

  it("plumbs default taskStore to plugin route context", async () => {
    const { app, taskStore, handlers } = buildApp();

    const res = await performGet(app, "/api/plugins/test-plugin/use-task-store");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ usedTaskStore: true });
    expect(taskStore.listTasks).toHaveBeenCalled();
    expect(handlers.taskStoreHandler).toHaveBeenCalled();
  });
});
