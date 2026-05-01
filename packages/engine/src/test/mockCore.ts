/**
 * Canonical @fusion/core mock helper for engine tests.
 *
 * Prefer extending this helper over suite-local full export lists.
 */
import type { Mock } from "vitest";

type AnyModule = Record<string, unknown>;

export async function createEngineCoreMock(
  importActual: () => Promise<AnyModule>,
  overrides: AnyModule = {},
): Promise<AnyModule> {
  const actual = await importActual();
  return {
    ...actual,
    ...overrides,
  };
}

export type MockFn = Mock;
