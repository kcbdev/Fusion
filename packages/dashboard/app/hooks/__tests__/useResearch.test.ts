import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useResearch } from "../useResearch";

const mockListResearchRuns = vi.fn();
const mockGetResearchRun = vi.fn();
const mockCreateResearchRun = vi.fn();
const mockCancelResearchRun = vi.fn();
const mockRetryResearchRun = vi.fn();
const mockExportResearchRun = vi.fn();
const mockCreateTaskFromResearchRun = vi.fn();
const mockAttachResearchRunToTask = vi.fn();
const mockSubscribeSse = vi.fn(() => vi.fn());

vi.mock("../../api", () => ({
  listResearchRuns: (...args: unknown[]) => mockListResearchRuns(...args),
  getResearchRun: (...args: unknown[]) => mockGetResearchRun(...args),
  createResearchRun: (...args: unknown[]) => mockCreateResearchRun(...args),
  cancelResearchRun: (...args: unknown[]) => mockCancelResearchRun(...args),
  retryResearchRun: (...args: unknown[]) => mockRetryResearchRun(...args),
  exportResearchRun: (...args: unknown[]) => mockExportResearchRun(...args),
  createTaskFromResearchRun: (...args: unknown[]) => mockCreateTaskFromResearchRun(...args),
  attachResearchRunToTask: (...args: unknown[]) => mockAttachResearchRunToTask(...args),
}));

vi.mock("../../sse-bus", () => ({
  subscribeSse: (...args: unknown[]) => mockSubscribeSse(...args),
}));

describe("useResearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListResearchRuns.mockResolvedValue({ runs: [], availability: { available: true } });
    mockGetResearchRun.mockResolvedValue({ run: { id: "RR-2", title: "t" }, availability: { available: true } });
  });

  it("loads research runs and availability", async () => {
    mockListResearchRuns.mockResolvedValue({
      runs: [{ id: "RR-1", query: "query", title: "query", status: "running", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
      availability: { available: true },
    });

    const { result } = renderHook(() => useResearch({ projectId: "p1" }));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.runs).toHaveLength(1);
      expect(result.current.availability.available).toBe(true);
    });
  });

  it("loads selected run detail", async () => {
    const { result } = renderHook(() => useResearch({ projectId: "p1" }));

    act(() => {
      result.current.setSelectedRunId("RR-2");
    });

    await waitFor(() => {
      expect(mockGetResearchRun).toHaveBeenCalledWith("RR-2", "p1");
    });
  });

  it("passes search query to list endpoint after debounce", async () => {
    const { result } = renderHook(() => useResearch({ projectId: "p1" }));
    act(() => {
      result.current.setSearchQuery("llm");
    });

    await waitFor(() => {
      expect(mockListResearchRuns).toHaveBeenLastCalledWith({ q: "llm", limit: 100 }, "p1");
    });
  });

  it("derives status counts and clears selected run when missing from refreshed list", async () => {
    mockListResearchRuns
      .mockResolvedValueOnce({
        runs: [
          { id: "RR-1", query: "a", title: "a", status: "running", createdAt: "", updatedAt: "" },
          { id: "RR-2", query: "b", title: "b", status: "failed", createdAt: "", updatedAt: "" },
        ],
        availability: { available: true },
      })
      .mockResolvedValueOnce({ runs: [{ id: "RR-2", query: "b", title: "b", status: "failed", createdAt: "", updatedAt: "" }], availability: { available: true } });

    const { result } = renderHook(() => useResearch({ projectId: "p1" }));

    await waitFor(() => {
      expect(result.current.statusCounts.running).toBe(1);
      expect(result.current.statusCounts.failed).toBe(1);
    });

    act(() => {
      result.current.setSelectedRunId("RR-1");
    });

    await waitFor(() => {
      expect(mockGetResearchRun).toHaveBeenCalledWith("RR-1", "p1");
    });

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.selectedRunId).toBeNull();
  });

  it("wires cancel/retry/export and task actions through API helpers", async () => {
    mockCancelResearchRun.mockResolvedValue({ run: { id: "RR-1" } });
    mockRetryResearchRun.mockResolvedValue({ run: { id: "RR-1" } });

    const { result } = renderHook(() => useResearch({ projectId: "p1" }));

    await act(async () => {
      await result.current.createRun({ query: "q", providers: ["web-search"] });
      await result.current.cancelRun("RR-1");
      await result.current.retryRun("RR-1");
      await result.current.exportRun("RR-1", "markdown");
      await result.current.createTaskFromRun("RR-1", "Title", "finding-1", "Body", "high", true);
      await result.current.attachRunToTask("RR-1", "FN-1", "finding-1", true);
    });

    expect(mockCreateResearchRun).toHaveBeenCalledWith({ query: "q", providers: ["web-search"] }, "p1");
    expect(mockCancelResearchRun).toHaveBeenCalledWith("RR-1", "p1");
    expect(mockRetryResearchRun).toHaveBeenCalledWith("RR-1", "p1");
    expect(mockExportResearchRun).toHaveBeenCalledWith("RR-1", "markdown", "p1");
    expect(mockCreateTaskFromResearchRun).toHaveBeenCalledWith(
      "RR-1",
      { title: "Title", findingId: "finding-1", description: "Body", priority: "high", attachExport: true },
      "p1",
    );
    expect(mockAttachResearchRunToTask).toHaveBeenCalledWith("RR-1", { taskId: "FN-1", findingId: "finding-1", attachExport: true }, "p1");
  });

  it("subscribes to research SSE events with project query and reconnect handler", async () => {
    renderHook(() => useResearch({ projectId: "p1" }));

    await waitFor(() => {
      expect(mockSubscribeSse).toHaveBeenCalledWith(
        "/api/events?projectId=p1",
        expect.objectContaining({
          events: expect.objectContaining({ "research:run:created": expect.any(Function) }),
          onReconnect: expect.any(Function),
        }),
      );
    });
  });
});
