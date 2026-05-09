import { afterEach, describe, expect, it, vi } from "vitest";
import { attachChatStream, streamChatResponse } from "../legacy";

function createChunkedStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

describe("streamChatResponse SSE parser", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reconstructs text/done events split across arbitrary chunks", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        createChunkedStream([
          "event: text\n",
          "data: \"Hel",
          "lo \"\n\n",
          "event: text\n",
          "data: \"world\"\n\n",
          "event: done\n",
          "data: {\"messageId\":\"msg-1\"}\n\n",
        ]),
        { status: 200 },
      ),
    );

    const textChunks: string[] = [];
    const donePayloads: Array<{ messageId: string; message?: { content: string } }> = [];

    streamChatResponse("s-1", "hi", {
      onText: (data) => textChunks.push(data),
      onDone: (data) => donePayloads.push(data),
      onError: vi.fn(),
    });

    await vi.waitFor(() => {
      expect(textChunks.join("")).toBe("Hello world");
      expect(donePayloads).toEqual([{ messageId: "msg-1" }]);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("flushes terminal done event when stream ends without final newline", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(createChunkedStream(["event: done\ndata: {\"messageId\":\"msg-tail\"}"]), { status: 200 }),
    );

    const donePayloads: Array<{ messageId: string }> = [];

    streamChatResponse("s-1", "hi", {
      onDone: (data) => donePayloads.push(data),
      onError: vi.fn(),
    });

    await vi.waitFor(() => {
      expect(donePayloads).toEqual([{ messageId: "msg-tail" }]);
    });
  });

  it("parses done payload assistant snapshots when present", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        createChunkedStream([
          "event: done\n",
          "data: {\"messageId\":\"msg-1\",\"message\":{\"id\":\"msg-1\",\"sessionId\":\"s-1\",\"role\":\"assistant\",\"content\":\"Final reply\",\"thinkingOutput\":null,\"metadata\":null,\"createdAt\":\"2026-01-01T00:00:00.000Z\"}}\n\n",
        ]),
        { status: 200 },
      ),
    );

    const donePayloads: Array<{ messageId: string; message?: { content: string } }> = [];

    streamChatResponse("s-1", "hi", {
      onDone: (data) => donePayloads.push(data),
      onError: vi.fn(),
    });

    await vi.waitFor(() => {
      expect(donePayloads).toEqual([
        {
          messageId: "msg-1",
          message: {
            id: "msg-1",
            sessionId: "s-1",
            role: "assistant",
            content: "Final reply",
            thinkingOutput: null,
            metadata: null,
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        },
      ]);
    });
  });

  it("handles done events that have no data payload", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(createChunkedStream(["event: done\n\n"]), { status: 200 }),
    );

    const donePayloads: Array<{ messageId: string }> = [];

    streamChatResponse("s-1", "hi", {
      onDone: (data) => donePayloads.push(data),
      onError: vi.fn(),
    });

    await vi.waitFor(() => {
      expect(donePayloads).toEqual([{ messageId: "" }]);
    });
  });

  it("fires onError when no stream events arrive before timeout", async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(": connected\n\n"));
      },
    }), { status: 200 }));

    const onError = vi.fn();
    streamChatResponse("s-1", "hi", { onError }, undefined, undefined, { firstEventTimeoutMs: 1_000 });

    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1_100);

    expect(onError).toHaveBeenCalledWith("Timed out waiting for first response event");
    vi.useRealTimers();
  });
});

describe("attachChatStream", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("replays buffered events and done", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        createChunkedStream([
          "event: text\n",
          "data: \"Hello\"\n\n",
          "event: done\n",
          "data: {\"messageId\":\"m-1\"}\n\n",
        ]),
        { status: 200 },
      ),
    );

    const textChunks: string[] = [];
    const donePayloads: Array<{ messageId: string }> = [];

    attachChatStream("s-1", {
      onText: (data) => textChunks.push(data),
      onDone: (data) => donePayloads.push(data),
      onError: vi.fn(),
    });

    await vi.waitFor(() => {
      expect(textChunks).toEqual(["Hello"]);
      expect(donePayloads).toEqual([{ messageId: "m-1" }]);
    });
  });

  it("delivers live events after replay", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        createChunkedStream([
          "event: text\n",
          "data: \"A\"\n\n",
          "event: text\n",
          "data: \"B\"\n\n",
        ]),
        { status: 200 },
      ),
    );

    const textChunks: string[] = [];

    attachChatStream("s-1", {
      onText: (data) => textChunks.push(data),
      onError: vi.fn(),
    });

    await vi.waitFor(() => {
      expect(textChunks).toEqual(["A", "B"]);
    });
  });

  it("aborts fetch when close is called", async () => {
    let signal: AbortSignal | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
      signal = init?.signal;
      return new Promise<Response>(() => {
        // keep open until aborted
      });
    });

    const stream = attachChatStream("s-1", { onError: vi.fn() });
    await vi.waitFor(() => {
      expect(signal).toBeDefined();
    });

    stream.close();
    expect(signal?.aborted).toBe(true);
    expect(stream.isConnected()).toBe(false);
  });
});
