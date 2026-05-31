import { describe, expect, it } from "vitest";
import { normalizeStreamingDelta, normalizeStreamingDeltaFromEvent } from "../streaming-delta.js";

describe("normalizeStreamingDelta", () => {
  it("repairs period + uppercase sentence boundaries across deltas", () => {
    expect(normalizeStreamingDelta("Let's compare them.", "Good overview.")).toBe(" Good overview.");
  });

  it("repairs punctuation boundaries for quoted, bracketed, and numeric starts", () => {
    expect(normalizeStreamingDelta("Done.", "\"Quoted\"")).toBe(" \"Quoted\"");
    expect(normalizeStreamingDelta("Great!", "(Next)")).toBe(" (Next)");
    expect(normalizeStreamingDelta("Ready?", "[Checklist]")).toBe(" [Checklist]");
    expect(normalizeStreamingDelta("Phase complete.", "2 more items")).toBe(" 2 more items");
    expect(normalizeStreamingDelta("Ready.", "'Single quote start'"))
      .toBe(" 'Single quote start'");
  });

  it("does not alter lowercase continuations or property access", () => {
    expect(normalizeStreamingDelta("foo.", "bar")).toBe("bar");
    expect(normalizeStreamingDelta("obj", ".prop")).toBe(".prop");
  });

  it("is idempotent when whitespace already exists", () => {
    expect(normalizeStreamingDelta("...task.", " Foundation")).toBe(" Foundation");
  });
});

describe("normalizeStreamingDeltaFromEvent", () => {
  it("derives previous text from same text block across deltas", () => {
    const partial = {
      content: [
        { type: "text", text: "execution.Foundation" },
      ],
    };

    expect(normalizeStreamingDeltaFromEvent(partial, 0, "Foundation", "text")).toBe(" Foundation");
  });

  it("repairs cross-block text boundaries when current block is empty", () => {
    const partial = {
      content: [
        { type: "text", text: "task." },
        { type: "text", text: "" },
      ],
    };

    expect(normalizeStreamingDeltaFromEvent(partial, 1, "Let us continue.", "text")).toBe(" Let us continue.");
  });

  it("repairs thinking deltas across thinking blocks", () => {
    const partial = {
      content: [
        { type: "thinking", thinking: "render." },
        { type: "thinking", thinking: "" },
      ],
    };

    expect(normalizeStreamingDeltaFromEvent(partial, 1, "Done", "thinking")).toBe(" Done");
  });

  it("returns delta unchanged for defensive edge cases", () => {
    expect(normalizeStreamingDeltaFromEvent(undefined, 0, "Foundation", "text")).toBe("Foundation");

    const outOfRange = { content: [{ type: "text", text: "execution" }] };
    expect(normalizeStreamingDeltaFromEvent(outOfRange, 3, "Foundation", "text")).toBe("Foundation");

    const wrongType = { content: [{ type: "thinking", thinking: "execution." }] };
    expect(normalizeStreamingDeltaFromEvent(wrongType, 0, "Foundation", "text")).toBe("Foundation");
  });

  it("matches wiring payload shape for execution.Foundation event forwarding", () => {
    const msgEvent = {
      contentIndex: 0,
      delta: "Foundation",
      partial: {
        content: [{ type: "text", text: "execution.Foundation" }],
      },
    };

    expect(
      normalizeStreamingDeltaFromEvent(msgEvent.partial, msgEvent.contentIndex, msgEvent.delta, "text"),
    ).toBe(" Foundation");
  });
});
