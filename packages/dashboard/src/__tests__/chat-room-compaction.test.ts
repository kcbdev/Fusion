import { describe, expect, it } from "vitest";
import { buildCompactedRoomTranscript } from "../chat.js";

function makeMessage(index: number, overrides: Partial<{
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
  senderAgentId: string | null;
}> = {}) {
  return {
    id: overrides.id ?? `msg-${index}`,
    role: overrides.role ?? (index % 2 === 0 ? "user" : "assistant"),
    content: overrides.content ?? `message-${index}`,
    createdAt: overrides.createdAt ?? `2026-01-01T00:00:${String(index).padStart(2, "0")}.000Z`,
    senderAgentId: "senderAgentId" in overrides ? (overrides.senderAgentId ?? null) : (index % 2 === 0 ? null : "agent-a"),
  };
}

describe("buildCompactedRoomTranscript", () => {
  it("returns all messages verbatim when the transcript fits inside the recent window", () => {
    const messages = Array.from({ length: 6 }, (_, index) => makeMessage(index));

    const transcript = buildCompactedRoomTranscript(messages, "msg-4");

    expect(transcript).not.toContain("## Earlier room context (compacted)");
    expect(transcript).toContain("message-0");
    expect(transcript).toContain("message-5");
    expect(transcript.match(/\[LATEST USER MESSAGE — ANSWER THIS\]/g)).toHaveLength(1);
  });

  it("prepends a compacted summary and keeps the last 12 messages verbatim", () => {
    const messages = Array.from({ length: 30 }, (_, index) => {
      const olderUserLengths = [40, 80, 120, 160, 200, 220, 60, 70, 90];
      const content = index < 18 && index % 2 === 0
        ? `older-user-${index}-` + "u".repeat(olderUserLengths[index / 2] ?? 20)
        : `message-${index}`;
      return makeMessage(index, { content });
    });
    const latestUserMessageId = "msg-28";

    const transcript = buildCompactedRoomTranscript(messages, latestUserMessageId);

    expect(transcript).toContain("## Earlier room context (compacted)");
    expect(transcript).toContain("- Span: 18 messages from 2026-01-01T00:00:00.000Z to 2026-01-01T00:00:17.000Z");
    expect(transcript).toContain("- Participants: User, Agent agent-a");
    const [summaryBlock] = transcript.split("\n\n");
    const highlightLines = summaryBlock.split("\n").filter((line) => line.startsWith("  - "));
    expect(highlightLines).toHaveLength(5);
    const highlightTimestamps = highlightLines.map((line) => line.match(/\[(.*?)\]/)?.[1] ?? "");
    expect(highlightTimestamps).toEqual([...highlightTimestamps].sort());

    for (let index = 18; index < 30; index += 1) {
      expect(transcript).toContain(`- [2026-01-01T00:00:${String(index).padStart(2, "0")}.000Z]`);
    }
    expect(transcript).toContain("(user) User: message-28 [LATEST USER MESSAGE — ANSWER THIS]");
  });

  it("preserves the latest marker exactly once even when the transcript must shrink", () => {
    const messages = Array.from({ length: 30 }, (_, index) => makeMessage(index, {
      role: index === 29 ? "user" : (index % 3 === 0 ? "assistant" : "user"),
      senderAgentId: index % 3 === 0 ? "agent-a" : null,
      content: `message-${index}-` + "x".repeat(1500),
    }));

    const transcript = buildCompactedRoomTranscript(messages, "msg-29");

    expect(transcript.length).toBeLessThanOrEqual(8000);
    expect(transcript.match(/\[LATEST USER MESSAGE — ANSWER THIS\]/g)).toHaveLength(1);
    expect(transcript).toContain("message-29-");
  });

  it("drops summary highlights from the bottom when the summary exceeds its cap", () => {
    const olderMessages = Array.from({ length: 18 }, (_, index) => makeMessage(index, {
      role: "user",
      content: `older-${index}-` + "z".repeat(500),
    }));
    const recentMessages = Array.from({ length: 12 }, (_, index) => makeMessage(index + 18, {
      role: index === 11 ? "user" : "assistant",
      senderAgentId: index === 11 ? null : `agent-${index}`,
      content: `recent-${index}`,
    }));

    const transcript = buildCompactedRoomTranscript([...olderMessages, ...recentMessages], "msg-29");
    const [summaryBlock] = transcript.split("\n\n");
    const highlightLines = summaryBlock.split("\n").filter((line) => line.startsWith("  - "));

    expect(summaryBlock).toContain("## Earlier room context (compacted)");
    expect(summaryBlock).toContain("- Span: 18 messages");
    expect(summaryBlock).toContain("- Participants: User");
    expect(summaryBlock).toContain("- Highlights:");
    expect(summaryBlock.length).toBeLessThanOrEqual(1500);
    expect(highlightLines.length).toBeLessThan(5);
  });

  it("keeps the total transcript under the overall cap", () => {
    const messages = Array.from({ length: 80 }, (_, index) => makeMessage(index, {
      role: index === 79 ? "user" : (index % 4 === 0 ? "system" : index % 2 === 0 ? "assistant" : "user"),
      senderAgentId: index % 2 === 0 && index % 4 !== 0 ? `agent-${index}` : null,
      content: `message-${index}-` + "q".repeat(4000),
    }));

    const transcript = buildCompactedRoomTranscript(messages, "msg-79");

    expect(transcript.length).toBeLessThanOrEqual(8000);
    expect(transcript).toContain("message-79-");
  });

  it("computes unique participant labels from older messages", () => {
    const older = [
      makeMessage(0, { role: "user", senderAgentId: null, content: "user older" }),
      makeMessage(1, { role: "assistant", senderAgentId: "agent-a", content: "agent a older" }),
      makeMessage(2, { role: "system", senderAgentId: null, content: "system older" }),
      makeMessage(3, { role: "assistant", senderAgentId: null, content: "assistant older" }),
      makeMessage(4, { role: "assistant", senderAgentId: "agent-b", content: "agent b older" }),
    ];
    const recent = Array.from({ length: 12 }, (_, index) => makeMessage(index + 5, {
      role: index === 11 ? "user" : "assistant",
      senderAgentId: index === 11 ? null : "agent-c",
      content: `recent-${index}`,
    }));

    const transcript = buildCompactedRoomTranscript([...older, ...recent], "msg-16");

    expect(transcript).toContain("- Participants: User, Agent agent-a, System, Assistant, Agent agent-b");
  });
});
