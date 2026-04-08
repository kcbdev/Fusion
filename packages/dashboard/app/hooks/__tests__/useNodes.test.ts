import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useNodes } from "../useNodes";
import * as api from "../../api";
import type { NodeInfo, NodeCreateInput } from "../../api";

vi.mock("../../api", () => ({
  fetchNodes: vi.fn(),
  registerNode: vi.fn(),
  updateNode: vi.fn(),
  unregisterNode: vi.fn(),
  checkNodeHealth: vi.fn(),
}));

const mockFetchNodes = vi.mocked(api.fetchNodes);
const mockRegisterNode = vi.mocked(api.registerNode);
const mockUpdateNode = vi.mocked(api.updateNode);
const mockUnregisterNode = vi.mocked(api.unregisterNode);
const mockCheckNodeHealth = vi.mocked(api.checkNodeHealth);

function makeNode(overrides: Partial<NodeInfo> = {}): NodeInfo {
  return {
    id: "node_local",
    name: "Local Node",
    type: "local",
    status: "online",
    capabilities: ["executor"],
    maxConcurrent: 2,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("useNodes", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockFetchNodes.mockReset();
    mockRegisterNode.mockReset();
    mockUpdateNode.mockReset();
    mockUnregisterNode.mockReset();
    mockCheckNodeHealth.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fetches nodes on mount", async () => {
    mockFetchNodes.mockResolvedValueOnce([makeNode()]);

    const { result } = renderHook(() => useNodes());

    await act(async () => {
      await flushPromises();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.nodes).toHaveLength(1);
    expect(result.current.nodes[0].name).toBe("Local Node");
  });

  it("handles fetch error gracefully", async () => {
    mockFetchNodes.mockRejectedValueOnce(new Error("boom"));

    const { result } = renderHook(() => useNodes());

    await act(async () => {
      await flushPromises();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe("boom");
  });

  it("register adds node optimistically", async () => {
    mockFetchNodes.mockResolvedValueOnce([]);
    const nodeInput: NodeCreateInput = { name: "Remote Node", type: "remote", url: "https://node.test" };
    const createdNode = makeNode({
      id: "node_remote",
      name: "Remote Node",
      type: "remote",
      url: "https://node.test",
      status: "connecting",
    });
    mockRegisterNode.mockResolvedValueOnce(createdNode);

    const { result } = renderHook(() => useNodes());

    await act(async () => {
      await flushPromises();
    });

    await act(async () => {
      await result.current.register(nodeInput);
    });

    expect(mockRegisterNode).toHaveBeenCalledWith(nodeInput);
    expect(result.current.nodes).toHaveLength(1);
    expect(result.current.nodes[0].id).toBe("node_remote");
  });

  it("update modifies node optimistically", async () => {
    mockFetchNodes.mockResolvedValueOnce([makeNode()]);
    const updatedNode = makeNode({ name: "Renamed Node", maxConcurrent: 4 });
    mockUpdateNode.mockResolvedValueOnce(updatedNode);

    const { result } = renderHook(() => useNodes());

    await act(async () => {
      await flushPromises();
    });

    await act(async () => {
      await result.current.update("node_local", { name: "Renamed Node", maxConcurrent: 4 });
    });

    expect(mockUpdateNode).toHaveBeenCalledWith("node_local", { name: "Renamed Node", maxConcurrent: 4 });
    expect(result.current.nodes[0].name).toBe("Renamed Node");
  });

  it("unregister removes node optimistically", async () => {
    mockFetchNodes.mockResolvedValueOnce([makeNode()]);
    mockUnregisterNode.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useNodes());

    await act(async () => {
      await flushPromises();
    });

    expect(result.current.nodes).toHaveLength(1);

    await act(async () => {
      await result.current.unregister("node_local");
    });

    expect(mockUnregisterNode).toHaveBeenCalledWith("node_local");
    expect(result.current.nodes).toHaveLength(0);
  });

  it("healthCheck updates node status in local state", async () => {
    mockFetchNodes.mockResolvedValueOnce([makeNode({ status: "offline" })]);
    mockCheckNodeHealth.mockResolvedValueOnce({
      nodeId: "node_local",
      status: "online",
      checkedAt: "2026-01-03T00:00:00.000Z",
    });

    const { result } = renderHook(() => useNodes());

    await act(async () => {
      await flushPromises();
    });

    expect(result.current.nodes[0].status).toBe("offline");

    await act(async () => {
      await result.current.healthCheck("node_local");
    });

    expect(mockCheckNodeHealth).toHaveBeenCalledWith("node_local");
    expect(result.current.nodes[0].status).toBe("online");
    expect(result.current.nodes[0].updatedAt).toBe("2026-01-03T00:00:00.000Z");
  });

  it("refresh manually refetches nodes", async () => {
    mockFetchNodes
      .mockResolvedValueOnce([makeNode({ name: "Before Refresh" })])
      .mockResolvedValueOnce([makeNode({ name: "After Refresh" })]);

    const { result } = renderHook(() => useNodes());

    await act(async () => {
      await flushPromises();
    });

    expect(result.current.nodes[0].name).toBe("Before Refresh");

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.nodes[0].name).toBe("After Refresh");
  });

  it("refetches when visibility changes back to visible", async () => {
    const originalVisibilityState = Object.getOwnPropertyDescriptor(document, "visibilityState");
    mockFetchNodes
      .mockResolvedValueOnce([makeNode({ name: "Initial" })])
      .mockResolvedValueOnce([makeNode({ name: "Visible Again" })]);

    const { result } = renderHook(() => useNodes());

    await act(async () => {
      await flushPromises();
    });

    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      writable: true,
      configurable: true,
    });

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });

    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      writable: true,
      configurable: true,
    });

    await act(async () => {
      vi.advanceTimersByTime(1100);
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });

    expect(result.current.nodes[0].name).toBe("Visible Again");

    if (originalVisibilityState) {
      Object.defineProperty(document, "visibilityState", originalVisibilityState);
    }
  });
});
