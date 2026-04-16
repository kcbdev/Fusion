import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { request } from "../test-request.js";
import { createServer } from "../server.js";

const mockListRuns = vi.fn().mockReturnValue([]);
const mockGetRun = vi.fn();
const mockCreateRun = vi.fn();
const mockListInsights = vi.fn().mockReturnValue([]);
const mockCountInsights = vi.fn().mockReturnValue(0);
const mockGetInsight = vi.fn();
const mockUpdateInsight = vi.fn();
const mockDeleteInsight = vi.fn();

const mockInsightStore = {
  listRuns: mockListRuns,
  getRun: mockGetRun,
  createRun: mockCreateRun,
  listInsights: mockListInsights,
  countInsights: mockCountInsights,
  getInsight: mockGetInsight,
  updateInsight: mockUpdateInsight,
  deleteInsight: mockDeleteInsight,
};

class MockStore extends EventEmitter {
  getRootDir(): string {
    return "/tmp/fn-1909";
  }

  getFusionDir(): string {
    return "/tmp/fn-1909/.fusion";
  }

  getDatabase() {
    return {
      exec: vi.fn(),
      prepare: vi.fn().mockReturnValue({ run: vi.fn().mockReturnValue({ changes: 0 }), get: vi.fn(), all: vi.fn().mockReturnValue([]) }),
    };
  }

  getInsightStore() {
    return mockInsightStore;
  }
}

describe("Insights routes", () => {
  const app = createServer(new MockStore() as any);

  beforeEach(() => {
    vi.clearAllMocks();
    mockListRuns.mockReturnValue([]);
    mockGetRun.mockReturnValue(null);
    mockCreateRun.mockReturnValue({ id: "IR-test-1", trigger: "manual", status: "running", projectId: "proj", createdAt: "2026-04-16T00:00:00.000Z" });
    mockListInsights.mockReturnValue([]);
    mockCountInsights.mockReturnValue(0);
    mockGetInsight.mockReturnValue(null);
    mockUpdateInsight.mockReturnValue(null);
    mockDeleteInsight.mockReturnValue(false);
  });

  // ── Route ordering regression: static routes must not be shadowed by /:id ──

  it("GET /api/insights/runs returns 200 with runs list (not 404 shadowed by /:id)", async () => {
    mockListRuns.mockReturnValue([
      { id: "IR-run-1", trigger: "manual", status: "completed", projectId: "proj", createdAt: "2026-04-16T00:00:00.000Z", completedAt: "2026-04-16T00:01:00.000Z" },
      { id: "IR-run-2", trigger: "schedule", status: "running", projectId: "proj", createdAt: "2026-04-16T00:02:00.000Z" },
    ]);

    const res = await request(app, "GET", "/api/insights/runs");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      runs: [
        { id: "IR-run-1", trigger: "manual", status: "completed", projectId: "proj", createdAt: "2026-04-16T00:00:00.000Z", completedAt: "2026-04-16T00:01:00.000Z" },
        { id: "IR-run-2", trigger: "schedule", status: "running", projectId: "proj", createdAt: "2026-04-16T00:02:00.000Z" },
      ],
    });
  });

  it("POST /api/insights/run creates a run successfully (not shadowed by /:id)", async () => {
    mockCreateRun.mockReturnValue({ id: "IR-run-new", trigger: "manual", status: "running", projectId: "proj", createdAt: "2026-04-16T00:00:00.000Z" });

    const res = await request(
      app,
      "POST",
      "/api/insights/run",
      JSON.stringify({ trigger: "manual" }),
      { "Content-Type": "application/json" },
    );

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: "IR-run-new", trigger: "manual", status: "running", projectId: "proj", createdAt: "2026-04-16T00:00:00.000Z" });
  });

  it("GET /api/insights/runs/:id returns run by id", async () => {
    mockGetRun.mockReturnValue({ id: "IR-run-1", trigger: "manual", status: "completed", projectId: "proj", createdAt: "2026-04-16T00:00:00.000Z", completedAt: "2026-04-16T00:01:00.000Z" });

    const res = await request(app, "GET", "/api/insights/runs/IR-run-1");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: "IR-run-1", trigger: "manual", status: "completed", projectId: "proj", createdAt: "2026-04-16T00:00:00.000Z", completedAt: "2026-04-16T00:01:00.000Z" });
  });

  it("GET /api/insights/runs/:id returns 404 when run not found", async () => {
    mockGetRun.mockReturnValue(null);

    const res = await request(app, "GET", "/api/insights/runs/IR-notfound");

    expect(res.status).toBe(404);
    expect((res.body as { error?: string }).error).toMatch(/Run not found: IR-notfound/);
  });

  // ── Insight CRUD routes ──────────────────────────────────────────────────

  it("GET /api/insights returns list of insights", async () => {
    mockListInsights.mockReturnValue([
      { id: "INS-1", title: "High priority", category: "quality", status: "generated", projectId: "proj" },
    ]);
    mockCountInsights.mockReturnValue(1);

    const res = await request(app, "GET", "/api/insights");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      insights: [{ id: "INS-1", title: "High priority", category: "quality", status: "generated", projectId: "proj" }],
      count: 1,
    });
  });

  it("GET /api/insights/:id returns insight by id", async () => {
    mockGetInsight.mockReturnValue({ id: "INS-1", title: "High priority", category: "quality", status: "generated", projectId: "proj" });

    const res = await request(app, "GET", "/api/insights/INS-1");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: "INS-1", title: "High priority", category: "quality", status: "generated", projectId: "proj" });
  });

  it("GET /api/insights/:id returns 404 when insight not found", async () => {
    mockGetInsight.mockReturnValue(null);

    const res = await request(app, "GET", "/api/insights/INS-notfound");

    expect(res.status).toBe(404);
    expect((res.body as { error?: string }).error).toMatch(/Insight not found: INS-notfound/);
  });

  it("PATCH /api/insights/:id updates insight status", async () => {
    mockUpdateInsight.mockReturnValue({ id: "INS-1", title: "High priority", category: "quality", status: "confirmed", projectId: "proj" });

    const res = await request(
      app,
      "PATCH",
      "/api/insights/INS-1",
      JSON.stringify({ status: "confirmed" }),
      { "Content-Type": "application/json" },
    );

    expect(res.status).toBe(200);
    expect(mockUpdateInsight).toHaveBeenCalledWith("INS-1", { status: "confirmed" });
  });

  it("DELETE /api/insights/:id deletes insight", async () => {
    mockDeleteInsight.mockReturnValue(true);

    const res = await request(app, "DELETE", "/api/insights/INS-1");

    expect(res.status).toBe(204);
  });

  it("POST /api/insights/:id/dismiss sets insight status to dismissed", async () => {
    mockUpdateInsight.mockReturnValue({ id: "INS-1", title: "High priority", status: "dismissed", projectId: "proj" });

    const res = await request(
      app,
      "POST",
      "/api/insights/INS-1/dismiss",
      JSON.stringify({}),
      { "Content-Type": "application/json" },
    );

    expect(res.status).toBe(200);
    expect(mockUpdateInsight).toHaveBeenCalledWith("INS-1", { status: "dismissed" });
  });

  it("POST /api/insights/:id/create-task returns insight data for task creation", async () => {
    mockGetInsight.mockReturnValue({ id: "INS-1", title: "Refactor X", content: "Consider refactoring module X", projectId: "proj" });

    const res = await request(
      app,
      "POST",
      "/api/insights/INS-1/create-task",
      JSON.stringify({}),
      { "Content-Type": "application/json" },
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      insight: { id: "INS-1", title: "Refactor X", content: "Consider refactoring module X", projectId: "proj" },
      suggestedTitle: "Refactor X",
      suggestedDescription: "Consider refactoring module X",
    });
  });
});
