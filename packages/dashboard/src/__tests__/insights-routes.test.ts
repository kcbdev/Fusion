import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import * as coreModule from "@fusion/core";
import { request } from "../test-request.js";
import { createServer } from "../server.js";

const piMocks = vi.hoisted(() => ({
  createFnAgent: vi.fn(),
  promptWithFallback: vi.fn(),
}));

vi.mock("@fusion/engine", async () => {
  const actual = await vi.importActual<typeof import("@fusion/engine")>("@fusion/engine");
  return {
    ...actual,
    createFnAgent: piMocks.createFnAgent,
    promptWithFallback: piMocks.promptWithFallback,
  };
});

const mockListRuns = vi.fn().mockReturnValue([]);
const mockGetRun = vi.fn();
const mockCreateRun = vi.fn();
const mockUpdateRun = vi.fn();
const mockListInsights = vi.fn().mockReturnValue([]);
const mockCountInsights = vi.fn().mockReturnValue(0);
const mockGetInsight = vi.fn();
const mockUpdateInsight = vi.fn();
const mockDeleteInsight = vi.fn();
const mockUpsertInsight = vi.fn();

const readWorkingMemorySpy = vi.spyOn(coreModule, "readWorkingMemory");
const readInsightsMemorySpy = vi.spyOn(coreModule, "readInsightsMemory");
const writeInsightsMemorySpy = vi.spyOn(coreModule, "writeInsightsMemory");
const buildPromptSpy = vi.spyOn(coreModule, "buildInsightExtractionPrompt");
const parseResponseSpy = vi.spyOn(coreModule, "parseInsightExtractionResponse");
const mergeInsightsSpy = vi.spyOn(coreModule, "mergeInsights");
const computeFingerprintSpy = vi.spyOn(coreModule, "computeInsightFingerprint");

const mockInsightStore = {
  listRuns: mockListRuns,
  getRun: mockGetRun,
  createRun: mockCreateRun,
  updateRun: mockUpdateRun,
  listInsights: mockListInsights,
  countInsights: mockCountInsights,
  getInsight: mockGetInsight,
  updateInsight: mockUpdateInsight,
  deleteInsight: mockDeleteInsight,
  upsertInsight: mockUpsertInsight,
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

    let runRecord = {
      id: "IR-run-new",
      projectId: "",
      trigger: "manual" as const,
      status: "pending" as const,
      summary: null,
      error: null,
      insightsCreated: 0,
      insightsUpdated: 0,
      inputMetadata: {},
      outputMetadata: {},
      createdAt: "2026-04-16T00:00:00.000Z",
      startedAt: null,
      completedAt: null,
    };

    mockListRuns.mockReturnValue([]);
    mockGetRun.mockReturnValue(null);
    mockCreateRun.mockImplementation((projectId: string, input: { trigger: "manual" }) => {
      runRecord = {
        ...runRecord,
        projectId,
        trigger: input.trigger,
      };
      return { ...runRecord };
    });
    mockUpdateRun.mockImplementation((_id: string, input: Record<string, unknown>) => {
      runRecord = {
        ...runRecord,
        ...input,
      } as typeof runRecord;
      return { ...runRecord };
    });
    mockListInsights.mockReturnValue([]);
    mockCountInsights.mockReturnValue(0);
    mockGetInsight.mockReturnValue(null);
    mockUpdateInsight.mockReturnValue(null);
    mockDeleteInsight.mockReturnValue(false);
    mockUpsertInsight.mockImplementation((_projectId: string, input: { title: string; content: string; category: string; fingerprint: string; provenance: Record<string, unknown> }) => ({
      id: "INS-created-1",
      projectId: _projectId,
      title: input.title,
      content: input.content,
      category: input.category,
      status: "confirmed",
      fingerprint: input.fingerprint,
      provenance: input.provenance,
      lastRunId: "IR-run-new",
      createdAt: "2026-04-16T00:10:00.000Z",
      updatedAt: "2026-04-16T00:10:00.000Z",
    }));

    readWorkingMemorySpy.mockResolvedValue("Test working memory content");
    readInsightsMemorySpy.mockResolvedValue(null);
    writeInsightsMemorySpy.mockResolvedValue(undefined);
    buildPromptSpy.mockReturnValue("Test prompt");
    parseResponseSpy.mockReturnValue({
      summary: "Test extraction",
      insights: [],
      extractedAt: "2026-04-16T00:00:00.000Z",
    });
    mergeInsightsSpy.mockReturnValue("# merged insights");
    computeFingerprintSpy.mockImplementation((title: string, category: string) => `fp-${category}-${title.length}`);

    piMocks.createFnAgent.mockImplementation((options: { onText?: (delta: string) => void }) => {
      options.onText?.('{"summary":"Test extraction","insights":[]}');
      return {
        session: {
          dispose: vi.fn(),
        },
      };
    });
    piMocks.promptWithFallback.mockResolvedValue(undefined);
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

  it("POST /api/insights/run executes AI extraction and returns completed run", async () => {
    const res = await request(
      app,
      "POST",
      "/api/insights/run",
      JSON.stringify({ trigger: "manual" }),
      { "Content-Type": "application/json" },
    );

    expect(res.status).toBe(201);
    expect(mockCreateRun).toHaveBeenCalledWith("", { trigger: "manual", inputMetadata: undefined });
    expect(mockUpdateRun).toHaveBeenNthCalledWith(
      1,
      "IR-run-new",
      expect.objectContaining({ status: "running", startedAt: expect.any(String) }),
    );
    expect(readWorkingMemorySpy).toHaveBeenCalledWith("/tmp/fn-1909");
    expect(buildPromptSpy).toHaveBeenCalledWith("Test working memory content", null);
    expect(piMocks.createFnAgent).toHaveBeenCalledTimes(1);
    expect(piMocks.promptWithFallback).toHaveBeenCalledTimes(1);
    expect(parseResponseSpy).toHaveBeenCalledTimes(1);
    expect(mockUpdateRun).toHaveBeenLastCalledWith(
      "IR-run-new",
      expect.objectContaining({
        status: "completed",
        insightsCreated: 0,
        insightsUpdated: 0,
        summary: "Test extraction",
        completedAt: expect.any(String),
      }),
    );
    expect(res.body).toEqual(
      expect.objectContaining({
        id: "IR-run-new",
        status: "completed",
        summary: "Test extraction",
      }),
    );
  });

  it("POST /api/insights/run marks run failed when working memory is empty", async () => {
    readWorkingMemorySpy.mockResolvedValue("   \n  ");

    const res = await request(
      app,
      "POST",
      "/api/insights/run",
      JSON.stringify({ trigger: "manual" }),
      { "Content-Type": "application/json" },
    );

    expect(res.status).toBe(201);
    expect(mockUpdateRun).toHaveBeenNthCalledWith(
      2,
      "IR-run-new",
      expect.objectContaining({
        status: "failed",
        error: "No working memory to analyze",
        completedAt: expect.any(String),
      }),
    );
    expect(piMocks.createFnAgent).not.toHaveBeenCalled();
    expect(piMocks.promptWithFallback).not.toHaveBeenCalled();
    expect(res.body).toEqual(
      expect.objectContaining({
        id: "IR-run-new",
        status: "failed",
        error: "No working memory to analyze",
      }),
    );
  });

  it("POST /api/insights/run marks run failed and returns 500 when AI execution errors", async () => {
    piMocks.promptWithFallback.mockRejectedValue(new Error("AI execution failed"));

    const res = await request(
      app,
      "POST",
      "/api/insights/run",
      JSON.stringify({ trigger: "manual" }),
      { "Content-Type": "application/json" },
    );

    expect(res.status).toBe(500);
    expect((res.body as { error?: string }).error).toContain("AI execution failed");
    expect(mockUpdateRun).toHaveBeenLastCalledWith(
      "IR-run-new",
      expect.objectContaining({
        status: "failed",
        error: "AI execution failed",
        completedAt: expect.any(String),
      }),
    );
  });

  it("POST /api/insights/run persists generated insights and tracks created vs updated counts", async () => {
    const longContent = "x".repeat(110);
    parseResponseSpy.mockReturnValue({
      summary: "Generated two insights",
      insights: [
        {
          category: "pattern",
          content: "Prefer shared hooks for common dashboard logic",
          extractedAt: "2026-04-16T00:20:00.000Z",
        },
        {
          category: "pitfall",
          content: longContent,
          extractedAt: "2026-04-16T00:20:00.000Z",
        },
      ],
      extractedAt: "2026-04-16T00:20:00.000Z",
    });
    mergeInsightsSpy.mockReturnValue("# merged result");

    mockUpsertInsight
      .mockReturnValueOnce({
        id: "INS-created",
        projectId: "",
        title: "Prefer shared hooks for common dashboard logic",
        content: "Prefer shared hooks for common dashboard logic",
        category: "workflow",
        status: "confirmed",
        fingerprint: "fp-workflow-46",
        provenance: { trigger: "manual" },
        lastRunId: "IR-run-new",
        createdAt: "2026-04-16T00:20:01.000Z",
        updatedAt: "2026-04-16T00:20:01.000Z",
      })
      .mockReturnValueOnce({
        id: "INS-updated",
        projectId: "",
        title: `${"x".repeat(100)}...`,
        content: longContent,
        category: "quality",
        status: "confirmed",
        fingerprint: "fp-quality-103",
        provenance: { trigger: "manual" },
        lastRunId: "IR-run-new",
        createdAt: "2026-04-16T00:00:00.000Z",
        updatedAt: "2026-04-16T00:20:01.000Z",
      });

    const res = await request(
      app,
      "POST",
      "/api/insights/run",
      JSON.stringify({ trigger: "manual" }),
      { "Content-Type": "application/json" },
    );

    expect(res.status).toBe(201);
    expect(writeInsightsMemorySpy).toHaveBeenCalledWith("/tmp/fn-1909", "# merged result");
    expect(mockUpsertInsight).toHaveBeenCalledTimes(2);
    expect(computeFingerprintSpy).toHaveBeenNthCalledWith(1, "Prefer shared hooks for common dashboard logic", "workflow");
    expect(computeFingerprintSpy).toHaveBeenNthCalledWith(2, `${"x".repeat(100)}...`, "quality");
    expect(mockUpdateRun).toHaveBeenLastCalledWith(
      "IR-run-new",
      expect.objectContaining({
        status: "completed",
        insightsCreated: 1,
        insightsUpdated: 1,
        summary: "Generated two insights",
      }),
    );
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
