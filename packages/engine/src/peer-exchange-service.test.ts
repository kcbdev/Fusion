import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { CentralCore, NodeConfig, PeerInfo } from "@fusion/core";
import { PeerExchangeService } from "./peer-exchange-service.js";

function makeNode(overrides: Partial<NodeConfig> = {}): NodeConfig {
  return {
    id: "node_remote",
    name: "Remote Node",
    type: "remote",
    url: "https://remote.example.com",
    apiKey: undefined,
    status: "online",
    maxConcurrent: 2,
    createdAt: "2026-04-01T10:00:00.000Z",
    updatedAt: "2026-04-01T12:00:00.000Z",
    ...overrides,
  };
}

function makePeerInfo(overrides: Partial<PeerInfo> = {}): PeerInfo {
  return {
    nodeId: "node_peer",
    nodeName: "Peer Node",
    nodeUrl: "https://peer.example.com",
    status: "online",
    metrics: null,
    lastSeen: "2026-04-01T12:00:00.000Z",
    maxConcurrent: 2,
    ...overrides,
  };
}

describe("PeerExchangeService", () => {
  let mockCentralCore: CentralCore;
  let mockFetch: ReturnType<typeof vi.fn>;
  let mockListNodes: ReturnType<typeof vi.fn>;
  let mockGetAllKnownPeerInfo: ReturnType<typeof vi.fn>;
  let mockMergePeers: ReturnType<typeof vi.fn>;
  let mockReportMeshState: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-01T12:00:00.000Z"));

    // Create individual mocks
    mockListNodes = vi.fn();
    mockGetAllKnownPeerInfo = vi.fn();
    mockMergePeers = vi.fn();
    mockReportMeshState = vi.fn();

    mockCentralCore = {
      listNodes: mockListNodes,
      getAllKnownPeerInfo: mockGetAllKnownPeerInfo,
      mergePeers: mockMergePeers,
      reportMeshState: mockReportMeshState,
    } as unknown as CentralCore;

    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should create service instance", () => {
      const service = new PeerExchangeService(mockCentralCore);
      expect(service).toBeDefined();
    });

    it("should accept custom sync interval", () => {
      const service = new PeerExchangeService(mockCentralCore, { syncIntervalMs: 30_000 });
      expect(service).toBeDefined();
    });
  });

  describe("syncWithNode()", () => {
    it("should send correct request body with auth header when apiKey is set", async () => {
      const node = makeNode({ apiKey: "secret-key" });
      mockListNodes.mockResolvedValue([
        makeNode({ id: "node_local", type: "local", status: "online" }),
      ]);
      mockGetAllKnownPeerInfo.mockResolvedValue([
        makePeerInfo({ nodeId: "node_local", nodeName: "local" }),
        makePeerInfo({ nodeId: "node_remote" }),
      ]);
      mockMergePeers.mockResolvedValue({ added: [], updated: [] });
      mockReportMeshState.mockResolvedValue({});
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          senderNodeId: "node_remote",
          senderNodeUrl: "https://remote.example.com",
          knownPeers: [],
          newPeers: [],
          timestamp: "2026-04-01T12:00:00.000Z",
        }),
      });

      const service = new PeerExchangeService(mockCentralCore);
      const result = await service.syncWithNode(node);

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://remote.example.com/api/mesh/sync",
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer secret-key",
          },
          body: expect.stringContaining('"senderNodeId":"node_local"'),
        })
      );
    });

    it("should send request without auth header when no apiKey", async () => {
      const node = makeNode({ apiKey: undefined });
      mockListNodes.mockResolvedValue([
        makeNode({ id: "node_local", type: "local", status: "online" }),
      ]);
      mockGetAllKnownPeerInfo.mockResolvedValue([]);
      mockMergePeers.mockResolvedValue({ added: [], updated: [] });
      mockReportMeshState.mockResolvedValue({});
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          senderNodeId: "node_remote",
          senderNodeUrl: "https://remote.example.com",
          knownPeers: [],
          newPeers: [],
          timestamp: "2026-04-01T12:00:00.000Z",
        }),
      });

      const service = new PeerExchangeService(mockCentralCore);
      await service.syncWithNode(node);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.not.objectContaining({ "Authorization": expect.anything() }),
        })
      );
    });

    it("should merge response.knownPeers (not just newPeers)", async () => {
      const node = makeNode();
      mockListNodes.mockResolvedValue([
        makeNode({ id: "node_local", type: "local", status: "online" }),
      ]);

      const allPeersFromResponse = [
        makePeerInfo({ nodeId: "node_local", nodeName: "local", status: "online" }),
        makePeerInfo({ nodeId: "node_peer_a", status: "online" }),
        makePeerInfo({ nodeId: "node_peer_b", status: "offline" }),
      ];

      mockGetAllKnownPeerInfo.mockResolvedValue([
        makePeerInfo({ nodeId: "node_local", nodeName: "local" }),
      ]);
      mockMergePeers.mockResolvedValue({ added: ["node_peer_a"], updated: ["node_peer_b"] });
      mockReportMeshState.mockResolvedValue({});
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          senderNodeId: "node_remote",
          senderNodeUrl: "https://remote.example.com",
          knownPeers: allPeersFromResponse,
          newPeers: [makePeerInfo({ nodeId: "node_peer_c" })],
          timestamp: "2026-04-01T12:00:00.000Z",
        }),
      });

      const service = new PeerExchangeService(mockCentralCore);
      const result = await service.syncWithNode(node);

      expect(result.success).toBe(true);
      // Verify merge was called with all knownPeers, not just newPeers
      expect(mockMergePeers).toHaveBeenCalledWith(allPeersFromResponse);
    });

    it("should refresh local metrics before sending request", async () => {
      const node = makeNode();
      mockListNodes.mockResolvedValue([
        makeNode({ id: "node_local", type: "local", status: "online" }),
      ]);
      mockGetAllKnownPeerInfo.mockResolvedValue([]);
      mockMergePeers.mockResolvedValue({ added: [], updated: [] });
      mockReportMeshState.mockResolvedValue({});
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          senderNodeId: "node_remote",
          senderNodeUrl: "https://remote.example.com",
          knownPeers: [],
          newPeers: [],
          timestamp: "2026-04-01T12:00:00.000Z",
        }),
      });

      const service = new PeerExchangeService(mockCentralCore);
      await service.syncWithNode(node);

      expect(mockReportMeshState).toHaveBeenCalled();
    });

    it("should handle network error gracefully", async () => {
      const node = makeNode();
      mockListNodes.mockResolvedValue([
        makeNode({ id: "node_local", type: "local", status: "online" }),
      ]);
      mockGetAllKnownPeerInfo.mockResolvedValue([]);
      mockReportMeshState.mockResolvedValue({});
      mockFetch.mockRejectedValue(new Error("Network error"));

      const service = new PeerExchangeService(mockCentralCore);
      const result = await service.syncWithNode(node);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Network error");
    });

    it("should handle non-2xx response", async () => {
      const node = makeNode();
      mockListNodes.mockResolvedValue([
        makeNode({ id: "node_local", type: "local", status: "online" }),
      ]);
      mockGetAllKnownPeerInfo.mockResolvedValue([]);
      mockReportMeshState.mockResolvedValue({});
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
      });

      const service = new PeerExchangeService(mockCentralCore);
      const result = await service.syncWithNode(node);

      expect(result.success).toBe(false);
      expect(result.error).toContain("HTTP 401");
    });
  });

  describe("triggerSync()", () => {
    it("should trigger sync when called", async () => {
      mockListNodes.mockResolvedValue([
        makeNode({ id: "node_local", type: "local", status: "online" }),
        makeNode({ id: "node_1", name: "Remote 1", status: "online", url: "https://remote1.example.com" }),
      ]);
      mockGetAllKnownPeerInfo.mockResolvedValue([]);
      mockMergePeers.mockResolvedValue({ added: [], updated: [] });
      mockReportMeshState.mockResolvedValue({});
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          senderNodeId: "node_1",
          senderNodeUrl: "https://remote1.example.com",
          knownPeers: [],
          newPeers: [],
          timestamp: "2026-04-01T12:00:00.000Z",
        }),
      });

      const service = new PeerExchangeService(mockCentralCore, { syncIntervalMs: 60_000 });
      const results = await service.triggerSync();

      expect(mockFetch).toHaveBeenCalled();
    });
  });
});
