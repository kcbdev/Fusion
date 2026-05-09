import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { ChatStore, Database } from "@fusion/core";
import type { TaskStore } from "@fusion/core";
import { createSSE } from "../sse.js";

class MockSocket extends EventEmitter {
  destroyed = false;
  setKeepAlive = vi.fn();
  destroy = vi.fn(() => {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit("close");
  });
}

class MockResponse extends EventEmitter {
  headers = new Map<string, string>();
  writableEnded = false;
  destroyed = false;
  write = vi.fn();
  flushHeaders = vi.fn();
  end = vi.fn(() => {
    if (this.writableEnded) return;
    this.writableEnded = true;
    this.emit("close");
  });

  constructor(readonly socket: MockSocket) {
    super();
  }

  setHeader(name: string, value: string): void {
    this.headers.set(name, value);
  }
}

function createMockStore(): TaskStore {
  const researchStore = {
    on: vi.fn(),
    off: vi.fn(),
  };
  return {
    on: vi.fn(),
    off: vi.fn(),
    getResearchStore: vi.fn(() => researchStore),
  } as unknown as TaskStore;
}

function openSseConnection(chatStore: ChatStore) {
  const store = createMockStore();
  const socket = new MockSocket();
  const req = new EventEmitter() as Request & { query: Record<string, string>; socket: MockSocket };
  req.query = { clientId: "chat-room-events" };
  req.socket = socket;
  const res = new MockResponse(socket);

  createSSE(store, undefined, undefined, undefined, undefined, undefined, undefined, chatStore)(
    req,
    res as unknown as Response,
  );

  return { req, res };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("chat room SSE events", () => {
  it("relays room lifecycle/member/message events and cleans up listeners", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "fusion-sse-chat-room-"));
    const fusionDir = join(tempRoot, ".fusion");
    const db = new Database(fusionDir, { inMemory: true });
    db.init();
    const chatStore = new ChatStore(fusionDir, db);
    const { req, res } = openSseConnection(chatStore);

    const room = chatStore.createRoom({
      name: "engineering",
      projectId: "proj-1",
      createdBy: "agent-owner",
      memberAgentIds: ["agent-owner"],
    });
    const member = chatStore.addRoomMember(room.id, "agent-2", "member");
    const message = chatStore.addRoomMessage(room.id, {
      role: "user",
      content: "hello room",
      senderAgentId: null,
      mentions: [],
    });
    const updatedRoom = chatStore.updateRoom(room.id, { description: "updated" });
    expect(updatedRoom).toBeDefined();
    chatStore.removeRoomMember(room.id, "agent-2");
    const attachmentUpdatedMessage = chatStore.addRoomMessageAttachment(room.id, message.id, {
      id: "att-1",
      filename: "doc.txt",
      originalName: "doc.txt",
      mimeType: "text/plain",
      size: 3,
      createdAt: new Date().toISOString(),
    });
    chatStore.deleteRoomMessage(message.id);
    chatStore.deleteRoom(room.id);

    expect(res.write).toHaveBeenCalledWith(`event: chat:room:created\ndata: ${JSON.stringify(room)}\n\n`);
    expect(res.write).toHaveBeenCalledWith(`event: chat:room:member:added\ndata: ${JSON.stringify(member)}\n\n`);
    expect(res.write).toHaveBeenCalledWith(`event: chat:room:message:added\ndata: ${JSON.stringify(message)}\n\n`);
    expect(res.write).toHaveBeenCalledWith(`event: chat:room:updated\ndata: ${JSON.stringify(updatedRoom)}\n\n`);
    expect(res.write).toHaveBeenCalledWith(
      `event: chat:room:member:removed\ndata: ${JSON.stringify({ roomId: room.id, agentId: "agent-2" })}\n\n`,
    );
    expect(res.write).toHaveBeenCalledWith(`event: chat:room:message:updated\ndata: ${JSON.stringify(attachmentUpdatedMessage)}\n\n`);
    expect(res.write).toHaveBeenCalledWith(`event: chat:room:message:deleted\ndata: ${JSON.stringify({ id: message.id })}\n\n`);
    expect(res.write).toHaveBeenCalledWith(`event: chat:room:deleted\ndata: ${JSON.stringify({ id: room.id })}\n\n`);

    req.emit("close");

    expect(EventEmitter.listenerCount(chatStore, "chat:room:created")).toBe(0);
    expect(EventEmitter.listenerCount(chatStore, "chat:room:updated")).toBe(0);
    expect(EventEmitter.listenerCount(chatStore, "chat:room:deleted")).toBe(0);
    expect(EventEmitter.listenerCount(chatStore, "chat:room:member:added")).toBe(0);
    expect(EventEmitter.listenerCount(chatStore, "chat:room:member:removed")).toBe(0);
    expect(EventEmitter.listenerCount(chatStore, "chat:room:message:added")).toBe(0);
    expect(EventEmitter.listenerCount(chatStore, "chat:room:message:updated")).toBe(0);
    expect(EventEmitter.listenerCount(chatStore, "chat:room:message:deleted")).toBe(0);

    db.close();
    await rm(tempRoot, { recursive: true, force: true });
  });
});
