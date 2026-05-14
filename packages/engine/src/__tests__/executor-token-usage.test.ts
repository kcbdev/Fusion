import { describe, expect, it } from "vitest";
import { TaskExecutor } from "../executor.js";

describe("executor token usage extraction", () => {
  it("uses canonical cache-read/cache-write split (FN-4389)", async () => {
    const executor = Object.create(TaskExecutor.prototype) as TaskExecutor;
    const methods = executor as unknown as {
      extractSessionTokenUsage: (session: unknown) => Promise<{ inputTokens: number; outputTokens: number; cachedTokens: number; cacheWriteTokens: number; totalTokens: number } | undefined>;
      accumulateTokenUsage: (existing: undefined, delta: { inputTokens: number; outputTokens: number; cachedTokens: number; cacheWriteTokens: number; totalTokens: number }) => { inputTokens: number; outputTokens: number; cachedTokens: number; cacheWriteTokens: number; totalTokens: number };
    };

    const delta = await methods.extractSessionTokenUsage({
      getSessionStats: () => ({
        tokens: { input: 1000, output: 500, cacheRead: 800, cacheWrite: 200, total: 2500 },
      }),
    });

    expect(delta).toMatchObject({
      inputTokens: 1000,
      outputTokens: 500,
      cachedTokens: 800,
      cacheWriteTokens: 200,
      totalTokens: 2500,
    });

    const merged = delta ? methods.accumulateTokenUsage(undefined, delta) : undefined;
    expect(merged).toMatchObject({
      inputTokens: 1000,
      outputTokens: 500,
      cachedTokens: 800,
      cacheWriteTokens: 200,
      totalTokens: 2500,
    });
  });
});
