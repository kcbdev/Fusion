// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { PluginLoader, PluginRunner } from "@fusion/core";
import { TaskStore } from "@fusion/core";

import { createApiRoutes } from "../routes.js";
import { createAuthMiddleware } from "../auth-middleware.js";
import { get as performGet, request as performRequest } from "../test-request.js";

describe("createApiRoutes plugin route wiring", () => {
  let rootDir: string;
  let globalDir: string;
  let store: TaskStore;
  let originalDaemonToken: string | undefined;

  const pluginId = "wire-test-plugin";

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "plugin-routes-wiring-"));
    globalDir = join(rootDir, ".fusion-global-settings");
    store = new TaskStore(rootDir, globalDir, { inMemoryDb: true });
    await store.init();
    originalDaemonToken = process.env.FUSION_DAEMON_TOKEN;
    delete process.env.FUSION_DAEMON_TOKEN;

    const pluginStore = store.getPluginStore();
    await pluginStore.registerPlugin({
      manifest: {
        id: pluginId,
        name: "Wire Test Plugin",
        version: "1.0.0",
        description: "Plugin route wiring test",
      },
      path: rootDir,
    });
  });

  afterEach(async () => {
    if (originalDaemonToken === undefined) {
      delete process.env.FUSION_DAEMON_TOKEN;
    } else {
      process.env.FUSION_DAEMON_TOKEN = originalDaemonToken;
    }
    await store.close();
    await rm(rootDir, { recursive: true, force: true });
  });

  function buildApp(options?: { token?: string }) {
    const pluginLoader = {
      getPlugin: vi.fn().mockReturnValue({ manifest: { id: pluginId } }),
      createRouteContext: vi.fn().mockImplementation(async () => ({
        pluginId,
        taskStore: store,
        settings: {},
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        emitEvent: vi.fn(),
      })),
    } as unknown as PluginLoader;

    const pluginRunner = {
      getPluginRoutes: vi.fn().mockReturnValue([
        {
          pluginId,
          route: {
            method: "GET",
            path: "/hello",
            handler: vi.fn().mockResolvedValue({ ok: true }),
          },
        },
      ]),
    } as unknown as PluginRunner;

    const app = express();
    app.use(express.json());

    if (options?.token) {
      process.env.FUSION_DAEMON_TOKEN = options.token;
      app.use(createAuthMiddleware(options.token));
    }

    app.use("/api", createApiRoutes(store, {
      pluginStore: store.getPluginStore(),
      pluginLoader,
      pluginRunner,
    }));
    app.use((_req, res) => {
      res.status(404).json({ error: "Not found" });
    });
    return app;
  }

  it("routes plugin-defined endpoints through createApiRoutes mount", async () => {
    const app = buildApp();

    const ok = await performGet(app, `/api/plugins/${pluginId}/hello`);
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ ok: true });
  });

  it("returns 404 for unknown plugin route paths", async () => {
    const app = buildApp();
    const missing = await performGet(app, `/api/plugins/${pluginId}/does-not-exist`);
    expect(missing.status).toBe(404);
  });

  it.each([
    ["missing token", undefined, 401],
    ["invalid token", "Bearer wrong-token", 401],
    ["valid token", "Bearer fn_valid_token_123", 200],
  ])("enforces bearer auth when daemon token is enabled: %s", async (_label, authHeader, expectedStatus) => {
    const app = buildApp({ token: "fn_valid_token_123" });
    const headers = authHeader ? { Authorization: authHeader } : undefined;

    const response = await performRequest(app, "GET", `/api/plugins/${pluginId}/hello`, undefined, headers);
    expect(response.status).toBe(expectedStatus);
    if (expectedStatus === 200) {
      expect(response.body).toEqual({ ok: true });
    }
  });

  it("keeps management plugin lookup route reachable", async () => {
    const app = buildApp();
    const res = await performGet(app, `/api/plugins/${pluginId}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: pluginId, name: "Wire Test Plugin" });
  });
});
