import { beforeEach, describe, expect, it, vi } from "vitest";

const warnMock = vi.fn();

vi.mock("../logger.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../logger.js")>();
  return {
    ...actual,
    createLogger: () => ({
      log: vi.fn(),
      info: vi.fn(),
      warn: warnMock,
      error: vi.fn(),
    }),
  };
});

describe("promptSessionAndCheck recursion guard (FN-4930)", () => {
  beforeEach(() => {
    warnMock.mockReset();
    vi.resetModules();
  });

  it("does not overflow when transcript-inspection metadata has pathological toJSON", async () => {
    const { promptSessionAndCheck } = await import("../pi.js");
    const recursive = {
      toJSON() {
        return { recursive };
      },
    };

    const state = {
      errorMessage: "",
      messages: [
        {
          role: "assistant",
          content: "ok",
          toolName: recursive,
          stopReason: recursive,
        },
      ],
    };

    const session = {
      prompt: vi.fn(async () => {
        state.errorMessage = "Cannot read properties of undefined (reading 'foo')";
      }),
      state,
    } as any;

    try {
      await promptSessionAndCheck(session, "hello");
    } catch (error) {
      expect((error as Error).message).toContain("Cannot read properties of undefined");
      expect((error as Error).message).not.toMatch(/Maximum call stack/i);
    }
    expect(warnMock).not.toHaveBeenCalledWith(expect.stringContaining("failed to inspect transcript"));
  });

  it("annotates unsupported message-role provider errors with actionable hint", async () => {
    const { promptSessionAndCheck } = await import("../pi.js");

    const state = {
      errorMessage: "",
      messages: [],
    };

    const session = {
      prompt: vi.fn(async () => {
        state.errorMessage =
          "developer is not one of ['system', 'assistant', 'user', 'tool', 'function'] - 'messages.[0].role'";
      }),
      state,
    } as any;

    await expect(promptSessionAndCheck(session, "hello")).rejects.toThrow(
      /developer is not one of \['system', 'assistant', 'user', 'tool', 'function'\] - 'messages\.\[0\]\.role'/,
    );
    await expect(promptSessionAndCheck(session, "hello")).rejects.toThrow(
      /Operator action required: this agent's configured model\/provider rejected a message role\./,
    );
  });
});
