// @vitest-environment node

import express from "express";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TaskStore } from "@fusion/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiRoutes } from "../routes.js";
import { get as performGet, request as performRequest } from "../test-request.js";
import { detectDevServerCandidates, invalidateDetectionCache } from "../dev-server-detect.js";
import { getDevServerManager } from "../dev-server-manager.js";

vi.mock("../dev-server-manager.js", () => ({
  getDevServerManager: vi.fn(),
  destroyAllDevServerManagers: vi.fn(),
}));

vi.mock("../dev-server-detect.js", () => ({
  detectDevServerCandidates: vi.fn(),
  invalidateDetectionCache: vi.fn(),
}));

type MockDevServerState = {
  id: string;
  name: string;
  status: "stopped" | "starting" | "running" | "failed";
  command: string;
  scriptName: string;
  cwd: string;
  logs: string[];
  previewUrl?: string;
  manualPreviewUrl?: string;
};

function createMockStore(rootDir: string): TaskStore {
  return {
    getRootDir: vi.fn().mockReturnValue(rootDir),
  } as unknown as TaskStore;
}

function buildApp(store: TaskStore) {
  const app = express();
  app.use(express.json());
  app.use("/api", createApiRoutes(store));
  return app;
}

async function GET(app: express.Express, pathName: string) {
  return performGet(app, pathName);
}

async function POST_JSON(app: express.Express, pathName: string, payload: unknown) {
  return performRequest(app, "POST", pathName, JSON.stringify(payload), {
    "content-type": "application/json",
  });
}

describe("dev-server routes", () => {
  let tempDir: string;
  let app: express.Express;
  let state: MockDevServerState;
  let manager: {
    getState: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    restart: ReturnType<typeof vi.fn>;
    setManualPreviewUrl: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    off: ReturnType<typeof vi.fn>;
  };

  const detectCandidatesMock = vi.mocked(detectDevServerCandidates);
  const invalidateDetectionCacheMock = vi.mocked(invalidateDetectionCache);
  const getDevServerManagerMock = vi.mocked(getDevServerManager);

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "fn-dev-server-routes-"));
    writeFileSync(
      path.join(tempDir, "package.json"),
      JSON.stringify({ scripts: { dev: "vite" } }, null, 2),
      "utf-8",
    );

    state = {
      id: "default",
      name: "default",
      status: "stopped",
      command: "",
      scriptName: "",
      cwd: tempDir,
      logs: [],
    };

    manager = {
      getState: vi.fn(() => structuredClone(state)),
      start: vi.fn(async (command: string, scriptName: string, cwd?: string) => {
        state = {
          ...state,
          status: "starting",
          command,
          scriptName,
          cwd: cwd ?? tempDir,
        };
        return structuredClone(state);
      }),
      stop: vi.fn(async () => {
        state = {
          ...state,
          status: "stopped",
        };
        return structuredClone(state);
      }),
      restart: vi.fn(async () => {
        state = {
          ...state,
          status: "running",
        };
        return structuredClone(state);
      }),
      setManualPreviewUrl: vi.fn((url: string | null) => {
        state = {
          ...state,
          manualPreviewUrl: url ?? undefined,
          previewUrl: url ?? undefined,
        };
        return structuredClone(state);
      }),
      on: vi.fn(),
      off: vi.fn(),
    };

    detectCandidatesMock.mockReset();
    invalidateDetectionCacheMock.mockReset();
    getDevServerManagerMock.mockReset();

    detectCandidatesMock.mockResolvedValue([
      {
        name: "dev",
        command: "vite",
        scriptName: "dev",
        cwd: tempDir,
        label: "Root > dev",
      },
    ]);

    getDevServerManagerMock.mockReturnValue(manager as never);

    app = buildApp(createMockStore(tempDir));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("GET /api/dev-server/candidates returns detected candidates", async () => {
    const res = await GET(app, "/api/dev-server/candidates");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toContainEqual(
      expect.objectContaining({
        scriptName: "dev",
      }),
    );
    expect(detectCandidatesMock).toHaveBeenCalledWith(tempDir);
  });

  it("GET /api/dev-server/status returns server state", async () => {
    const res = await GET(app, "/api/dev-server/status");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        id: "default",
        name: "default",
        status: expect.any(String),
        command: expect.any(String),
        logs: expect.any(Array),
      }),
    );
  });

  it("POST /api/dev-server/start starts a server", async () => {
    const res = await POST_JSON(app, "/api/dev-server/start", {
      command: "echo test",
      scriptName: "test",
    });

    expect(res.status).toBe(200);
    expect(res.body.status).not.toBe("stopped");
    expect(res.body.command).toBe("echo test");
    expect(manager.start).toHaveBeenCalledWith("echo test", "test", undefined);
    expect(invalidateDetectionCacheMock).toHaveBeenCalledWith(tempDir);
  });

  it("POST /api/dev-server/start validates missing command", async () => {
    const res = await POST_JSON(app, "/api/dev-server/start", {
      scriptName: "test",
    });

    expect(res.status).toBe(400);
  });

  it("POST /api/dev-server/start validates missing scriptName", async () => {
    const res = await POST_JSON(app, "/api/dev-server/start", {
      command: "echo test",
    });

    expect(res.status).toBe(400);
  });

  it("POST /api/dev-server/stop stops the server", async () => {
    await POST_JSON(app, "/api/dev-server/start", {
      command: "echo test",
      scriptName: "test",
    });

    const res = await POST_JSON(app, "/api/dev-server/stop", {});

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("stopped");
    expect(manager.stop).toHaveBeenCalled();
  });

  it("POST /api/dev-server/restart restarts the server", async () => {
    await POST_JSON(app, "/api/dev-server/start", {
      command: "echo test",
      scriptName: "test",
    });

    const res = await POST_JSON(app, "/api/dev-server/restart", {});

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("running");
    expect(manager.restart).toHaveBeenCalled();
  });

  it("POST /api/dev-server/preview-url sets manual preview URL", async () => {
    const res = await POST_JSON(app, "/api/dev-server/preview-url", {
      url: "http://localhost:9999",
    });

    expect(res.status).toBe(200);
    expect(res.body.manualPreviewUrl).toBe("http://localhost:9999");
  });

  it("POST /api/dev-server/preview-url accepts null URL", async () => {
    const res = await POST_JSON(app, "/api/dev-server/preview-url", {
      url: null,
    });

    expect(res.status).toBe(200);
    expect(res.body.manualPreviewUrl).toBeUndefined();
  });

  it("POST /api/dev-server/preview-url validates URL type", async () => {
    const res = await POST_JSON(app, "/api/dev-server/preview-url", {
      url: 123,
    });

    expect(res.status).toBe(400);
  });

  it("GET /api/dev-server/logs/stream exposes SSE headers and connected event", async () => {
    const server = app.listen(0);

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Failed to resolve test server address");
      }

      const response = await fetch(`http://127.0.0.1:${address.port}/api/dev-server/logs/stream`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/event-stream");

      const reader = response.body?.getReader();
      const firstChunk = await reader?.read();
      const text = firstChunk?.value ? new TextDecoder().decode(firstChunk.value) : "";

      expect(text).toContain("event: connected");
      await reader?.cancel();
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
      });
    }
  });
});
