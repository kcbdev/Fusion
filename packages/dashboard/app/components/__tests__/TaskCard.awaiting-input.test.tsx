import React from "react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TaskCard } from "../TaskCard";
import type { Task } from "@fusion/core";

/**
 * U14: the awaiting-input card state — a task whose column engine parked on a
 * structured question renders a distinct, visually-stronger "Needs input" badge
 * (it is blocked on the human). LFG tasks never reach this state because the
 * server never persists `awaiting-user-input` for them (asserted server-side in
 * pending-question-routes.test.ts); here we assert the card surfaces the state
 * when (and only when) the status is set.
 */

vi.mock("lucide-react", () => {
  const Stub = () => null;
  return new Proxy({}, { get: () => Stub });
});

vi.mock("../ProviderIcon", () => ({
  ProviderIcon: ({ provider }: { provider: string }) => <span data-testid={`provider-icon-${provider}`} />,
}));

vi.mock("../../hooks/useTaskDiffStats", () => ({
  useTaskDiffStats: () => ({ stats: null, loading: false }),
}));

const badgeUpdatesMock = new Map<string, unknown>();
vi.mock("../../hooks/useBadgeWebSocket", () => ({
  useBadgeWebSocket: () => ({
    badgeUpdates: badgeUpdatesMock,
    isConnected: true,
    subscribeToBadge: vi.fn(),
    unsubscribeFromBadge: vi.fn(),
  }),
}));

vi.mock("../../hooks/useBatchBadgeFetch", () => ({
  getFreshBatchData: vi.fn(() => null),
}));

vi.mock("../../api", () => ({
  fetchTaskDetail: vi.fn(),
  uploadAttachment: vi.fn(),
  fetchMission: vi.fn(),
  fetchAgent: vi.fn(),
  fetchAgents: vi.fn(),
}));

vi.mock("../../hooks/useConfirm", () => ({
  useConfirm: () => ({ confirm: vi.fn(), confirmWithChoice: vi.fn() }),
}));

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "FN-001",
    title: "Test task",
    column: "in-progress",
    status: undefined as never,
    steps: [],
    dependencies: [],
    description: "",
    ...overrides,
  } as Task;
}

const noop = () => {};

function renderCard(task: Task) {
  return render(<TaskCard task={task} onOpenDetail={noop} addToast={noop} />);
}

afterEach(() => {
  badgeUpdatesMock.clear();
  vi.clearAllMocks();
});

describe("TaskCard awaiting-input state (U14)", () => {
  it("renders the 'Needs input' status badge when the task is awaiting-user-input", () => {
    const { container } = renderCard(makeTask({ status: "awaiting-user-input" as never }));
    expect(screen.getByText("Needs input")).toBeTruthy();
    // The card and status badge carry the distinct awaiting-input class.
    expect(container.querySelector(".card.awaiting-input")).toBeTruthy();
    expect(container.querySelector(".card-status-badge.awaiting-input")).toBeTruthy();
  });

  it("an idle in-progress task does NOT render the awaiting-input badge/class", () => {
    const { container } = renderCard(makeTask({ status: "in-progress" as never }));
    expect(screen.queryByText("Needs input")).toBeNull();
    expect(container.querySelector(".card.awaiting-input")).toBeNull();
  });

  it("the awaiting-input state is visually distinct from a stuck task", () => {
    const { container } = renderCard(makeTask({ status: "awaiting-user-input" as never }));
    // It is awaiting-input, not stuck — the stuck class/label must not apply.
    expect(container.querySelector(".card.stuck")).toBeNull();
    expect(screen.queryByText("Stuck")).toBeNull();
  });
});
