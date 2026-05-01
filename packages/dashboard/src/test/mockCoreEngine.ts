/**
 * Canonical @fusion/core and @fusion/engine mock helpers for dashboard server tests.
 *
 * Add new mocked exports here first before duplicating large per-suite mock objects.
 */
import { vi } from "vitest";

type AnyModule = Record<string, unknown>;

export async function createCoreMock(
  importActual: () => Promise<AnyModule>,
  overrides: AnyModule = {},
): Promise<AnyModule> {
  const actual = await importActual();
  return {
    ...actual,
    ...overrides,
  };
}

export function createEngineMock(overrides: AnyModule = {}): AnyModule {
  return {
    createFnAgent: vi.fn(),
    promptWithFallback: vi.fn(),
    ...overrides,
  };
}
