/*
 * FNXC:PlannerOversight 2026-07-04-00:00:
 * FN-7516 card-surface tests for the read-only effective oversight-level badge
 * and the active-overseer-state indicator. Covers the Surface Enumeration data
 * states: Observe/Steer/Autonomous render a labeled badge; an explicit "off"
 * effective level renders nothing (no empty shell); an unset per-task override
 * resolves to the schema default ("autonomous") rather than rendering nothing,
 * per code review. The overseer-state indicator renders only while the
 * card-local watched-stage derivation (`deriveOverseerCardWatchedStage` in
 * TaskCard.tsx, mirroring the engine's `resolveWatchedStage`) resolves a stage
 * AND the task is not paused/done/archived AND the effective oversight level
 * is not "off". Round-2 code-review fix covered here: when a card must fetch
 * the workflow's effective oversight tier (no synchronous per-task override),
 * neither badge renders until that fetch resolves — the schema default must
 * never render as a guess while the true workflow tier is unknown.
 */
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { TaskCard, __test_areTaskCardPropsEqual, __test_clearWorkflowOversightEffectiveCache } from "../TaskCard";
import type { Task } from "@fusion/core";
import { fetchWorkflowSettingValues } from "../../api";



vi.mock("../ProviderIcon", () => ({
  ProviderIcon: () => null,
}));

vi.mock("../PluginSlot", () => ({
  PluginSlot: () => null,
}));

vi.mock("../../hooks/useTaskDiffStats", () => ({
  useTaskDiffStats: () => ({ stats: null, loading: false }),
}));

vi.mock("../../hooks/useBadgeWebSocket", () => ({
  useBadgeWebSocket: () => ({
    badgeUpdates: new Map(),
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
  rebuildTaskSpec: vi.fn(),
  // FNXC:PlannerOversight 2026-07-04-12:30: the FN-7516 code-review fix reads
  // the workflow's effective plannerOversightLevel setting via this route
  // when the workflowBadge prop's workflowId is set (see
  // loadWorkflowOversightEffectiveLevel in TaskCard.tsx). Default resolves an
  // empty effective map (no override).
  fetchWorkflowSettingValues: vi.fn().mockResolvedValue({ stored: {}, effective: {}, orphaned: [] }),
}));

vi.mock("../../hooks/useConfirm", () => ({
  useConfirm: () => ({ confirm: vi.fn(), confirmWithChoice: vi.fn() }),
}));

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "FN-001",
    title: "Test task",
    column: "in-progress",
    status: "planning" as Task["status"],
    steps: [],
    dependencies: [],
    description: "",
    ...overrides,
  } as Task;
}

const noop = () => {};

function renderCard(overrides: Partial<Task> = {}, cardProps: { workflowBadge?: { workflowId: string; workflowName: string; workflowIcon?: string } } = {}) {
  return render(<TaskCard task={makeTask(overrides)} onOpenDetail={noop} addToast={noop} {...cardProps} />);
}

afterEach(() => {
  vi.clearAllMocks();
  __test_clearWorkflowOversightEffectiveCache();
});

describe("TaskCard effective oversight-level badge (FN-7516)", () => {
  it.each([
    ["observe", "Observe"],
    ["steer", "Steer"],
    ["autonomous", "Auto-recovery"],
  ] as const)("renders the badge for level=%s with the correct label/modifier/testid", (level, label) => {
    renderCard({ plannerOversightLevel: level, column: "todo" });

    const badge = screen.getByTestId("card-oversight-badge");
    expect(badge).toBeTruthy();
    expect(badge.className).toContain(`card-oversight-badge--${level}`);
    expect(badge.textContent).toBe(label);
    expect(badge.getAttribute("title")).toBe(`Oversight: ${label}`);
  });

  it("renders no badge (no empty shell) when the effective level is off", () => {
    renderCard({ plannerOversightLevel: "off", column: "todo" });

    expect(screen.queryByTestId("card-oversight-badge")).toBeNull();
  });

  it("resolves the schema default (autonomous) — and renders the badge — when the level field is undefined", () => {
    renderCard({ column: "todo" });

    const badge = screen.getByTestId("card-oversight-badge");
    expect(badge).toBeTruthy();
    expect(badge.className).toContain("card-oversight-badge--autonomous");
    expect(badge.textContent).toBe("Auto-recovery");
  });

  it("does not render an always-on empty card-meta-badges child for the explicit-off case", () => {
    const { container } = renderCard({ plannerOversightLevel: "off", column: "todo" });

    const metaBadges = container.querySelector(".card-meta-badges");
    // Either the wrapper is entirely absent, or if present for some other
    // reason it must not contain an oversight badge element.
    if (metaBadges) {
      expect(metaBadges.querySelector(".card-oversight-badge")).toBeNull();
    }
  });
});

describe("TaskCard active-overseer-state indicator (FN-7516)", () => {
  it.each([
    ["in-progress", {}, "executor", "Executor"],
    ["in-review", { reviewState: { source: "reviewer-agent", items: [], addressing: [] } }, "reviewer", "Reviewer"],
    ["in-review", { prInfo: { number: 1, status: "open" } }, "pull-request", "Pull request"],
    [
      "in-review",
      { workflowTransitionNotification: { kind: "manual-merge-hold", column: "in-review", transitionId: "t1", createdAt: "2026-01-01" } },
      "merger",
      "Merger",
    ],
    ["in-review", {}, "merger", "Merger"],
  ] as const)("renders the indicator for column=%s state=%o with stage=%s", (column, stateOverrides, stage, label) => {
    renderCard({ column, plannerOversightLevel: "steer", ...(stateOverrides as Partial<Task>) });

    const badge = screen.getByTestId("card-overseer-state-badge");
    expect(badge).toBeTruthy();
    expect(badge.className).toContain(`card-overseer-state-badge--${stage}`);
    expect(badge.textContent).toContain(label);
    expect(badge.getAttribute("title")).toBe(`Overseer: ${label}`);
  });

  it("renders the workflow-gate stage when paused on a workflow input/approval gate", () => {
    renderCard({
      column: "in-progress",
      plannerOversightLevel: "steer",
      paused: true,
      pausedReason: "workflow-cli-approval:node-1",
    });

    const badge = screen.getByTestId("card-overseer-state-badge");
    expect(badge).toBeTruthy();
    expect(badge.className).toContain("card-overseer-state-badge--workflow-gate");
    expect(badge.textContent).toContain("Workflow gate");
  });

  it("renders no indicator (no empty shell) when the task is not in a monitorable column", () => {
    renderCard({ column: "todo", plannerOversightLevel: "steer" });

    expect(screen.queryByTestId("card-overseer-state-badge")).toBeNull();
  });

  it("renders no indicator when the effective oversight level is off", () => {
    renderCard({ column: "in-progress", plannerOversightLevel: "off" });

    expect(screen.queryByTestId("card-overseer-state-badge")).toBeNull();
  });

  it("suppresses the indicator when the task is user-paused", () => {
    renderCard({ column: "in-progress", plannerOversightLevel: "steer", userPaused: true });

    expect(screen.queryByTestId("card-overseer-state-badge")).toBeNull();
  });

  it("suppresses the indicator when the task is agent-paused off a workflow gate", () => {
    renderCard({ column: "in-progress", plannerOversightLevel: "steer", paused: true, pausedReason: "some-other-reason" });

    expect(screen.queryByTestId("card-overseer-state-badge")).toBeNull();
  });

  it("suppresses the indicator when the task column is done", () => {
    renderCard({ column: "done", plannerOversightLevel: "steer" });

    expect(screen.queryByTestId("card-overseer-state-badge")).toBeNull();
  });

  it("suppresses the indicator when the task column is archived", () => {
    renderCard({ column: "archived", plannerOversightLevel: "steer" });

    expect(screen.queryByTestId("card-overseer-state-badge")).toBeNull();
  });

  it("does not render an always-on empty card-meta-badges child when both level is off and overseer is inactive", () => {
    const { container } = renderCard({ plannerOversightLevel: "off", column: "todo" });

    const metaBadges = container.querySelector(".card-meta-badges");
    if (metaBadges) {
      expect(metaBadges.querySelector(".card-overseer-state-badge")).toBeNull();
      expect(metaBadges.querySelector(".card-oversight-badge")).toBeNull();
    }
  });
});

describe("TaskCard workflow-effective oversight level (FN-7516 code-review fix)", () => {
  it("resolves the workflow's effective plannerOversightLevel (not the schema default) when no per-task override is set", async () => {
    vi.mocked(fetchWorkflowSettingValues).mockResolvedValueOnce({
      stored: { plannerOversightLevel: "off" },
      effective: { plannerOversightLevel: "off" },
      orphaned: [],
    });

    renderCard({ column: "todo" }, { workflowBadge: { workflowId: "wf-configured-off", workflowName: "Configured Off" } });

    // FNXC:PlannerOversight 2026-07-04-16:00: round-2 code-review fix — the
    // schema default must NOT render transiently before the workflow-tier
    // fetch resolves (a task inheriting a workflow explicitly configured to
    // "off" must never flash "Auto-recovery"). No badge at all should be
    // present immediately after mount, while the fetch is still in flight.
    expect(screen.queryByTestId("card-oversight-badge")).toBeNull();
    await waitFor(() => {
      expect(fetchWorkflowSettingValues).toHaveBeenCalledWith("wf-configured-off", undefined);
    });
    await waitFor(() => {
      expect(screen.queryByTestId("card-oversight-badge")).toBeNull();
    });
  });

  it("does not render the schema-default badge while the workflow-tier fetch is pending (round-2 code-review fix)", async () => {
    let resolveFetch!: (value: { stored: Record<string, unknown>; effective: Record<string, unknown>; orphaned: unknown[] }) => void;
    vi.mocked(fetchWorkflowSettingValues).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    renderCard({ column: "todo" }, { workflowBadge: { workflowId: "wf-pending", workflowName: "Pending" } });

    // While the fetch is unresolved, no badge should render at all — not even
    // the schema default ("Auto-recovery"). Rendering a guessed default here
    // was the exact bug the second code-review round flagged.
    await waitFor(() => {
      expect(fetchWorkflowSettingValues).toHaveBeenCalledWith("wf-pending", undefined);
    });
    expect(screen.queryByTestId("card-oversight-badge")).toBeNull();
    expect(screen.queryByTestId("card-overseer-state-badge")).toBeNull();

    // Once the fetch resolves (workflow has no oversight setting → schema
    // default applies), the badge appears.
    resolveFetch({ stored: {}, effective: {}, orphaned: [] });
    const badge = await screen.findByTestId("card-oversight-badge");
    expect(badge.className).toContain("card-oversight-badge--autonomous");
  });

  it("renders a per-task override immediately even while the workflow-tier fetch is pending", async () => {
    vi.mocked(fetchWorkflowSettingValues).mockReturnValueOnce(new Promise(() => {})); // never resolves

    renderCard(
      { column: "todo", plannerOversightLevel: "steer" },
      { workflowBadge: { workflowId: "wf-never-resolves", workflowName: "Never resolves" } },
    );

    // A synchronous per-task override is known from the task payload alone,
    // so it must not wait on the workflow-tier fetch.
    const badge = screen.getByTestId("card-oversight-badge");
    expect(badge.className).toContain("card-oversight-badge--steer");
  });

  it("prefers the per-task override over the workflow's effective level", async () => {
    vi.mocked(fetchWorkflowSettingValues).mockResolvedValueOnce({
      stored: { plannerOversightLevel: "off" },
      effective: { plannerOversightLevel: "off" },
      orphaned: [],
    });

    renderCard({ column: "todo", plannerOversightLevel: "steer" }, { workflowBadge: { workflowId: "wf-configured-off", workflowName: "Configured Off" } });

    const badge = await screen.findByTestId("card-oversight-badge");
    expect(badge.className).toContain("card-oversight-badge--steer");
  });

  it("renders the workflow's effective non-default level (observe) when no per-task override is set", async () => {
    vi.mocked(fetchWorkflowSettingValues).mockResolvedValueOnce({
      stored: { plannerOversightLevel: "observe" },
      effective: { plannerOversightLevel: "observe" },
      orphaned: [],
    });

    renderCard({ column: "todo" }, { workflowBadge: { workflowId: "wf-configured-observe", workflowName: "Configured Observe" } });

    const badge = await screen.findByTestId("card-oversight-badge");
    expect(badge.className).toContain("card-oversight-badge--observe");
  });
});

describe("TaskCard memo comparator — oversight level and overseer state (FN-7516)", () => {
  it("returns false when task.plannerOversightLevel changes, so the card repaints", () => {
    const base = makeTask({ plannerOversightLevel: "observe" });
    const changed = makeTask({ plannerOversightLevel: "steer" });

    expect(
      __test_areTaskCardPropsEqual(
        { task: base, onOpenDetail: noop, addToast: noop } as any,
        { task: changed, onOpenDetail: noop, addToast: noop } as any,
      ),
    ).toBe(false);
  });

  it("returns false when task.reviewState changes, so the overseer-state badge repaints", () => {
    const base = makeTask({ column: "in-review" });
    const changed = makeTask({ column: "in-review", reviewState: { source: "reviewer-agent", items: [], addressing: [] } });

    expect(
      __test_areTaskCardPropsEqual(
        { task: base, onOpenDetail: noop, addToast: noop } as any,
        { task: changed, onOpenDetail: noop, addToast: noop } as any,
      ),
    ).toBe(false);
  });

  it("returns false when task.pausedReason changes, so the workflow-gate stage repaints", () => {
    const base = makeTask({ column: "in-progress", paused: true, pausedReason: "workflow-cli-approval:a" });
    const changed = makeTask({ column: "in-progress", paused: true, pausedReason: "workflow-cli-approval:b" });

    expect(
      __test_areTaskCardPropsEqual(
        { task: base, onOpenDetail: noop, addToast: noop } as any,
        { task: changed, onOpenDetail: noop, addToast: noop } as any,
      ),
    ).toBe(false);
  });

  it("returns false when task.workflowTransitionNotification changes, so the merger stage repaints", () => {
    const base = makeTask({ column: "in-review" });
    const changed = makeTask({
      column: "in-review",
      workflowTransitionNotification: { kind: "manual-merge-hold", column: "in-review", transitionId: "t1", createdAt: "2026-01-01" },
    });

    expect(
      __test_areTaskCardPropsEqual(
        { task: base, onOpenDetail: noop, addToast: noop } as any,
        { task: changed, onOpenDetail: noop, addToast: noop } as any,
      ),
    ).toBe(false);
  });

  it("returns false when workflowBadge.workflowId changes, so the workflow-effective oversight tier re-resolves", () => {
    const task = makeTask({});

    expect(
      __test_areTaskCardPropsEqual(
        { task, workflowBadge: { workflowId: "wf-a", workflowName: "A" }, onOpenDetail: noop, addToast: noop } as any,
        { task, workflowBadge: { workflowId: "wf-b", workflowName: "B" }, onOpenDetail: noop, addToast: noop } as any,
      ),
    ).toBe(false);
  });

  it("returns true when nothing relevant changes, including plannerOversightLevel", () => {
    const base = makeTask({ plannerOversightLevel: "steer" });
    const same = makeTask({ plannerOversightLevel: "steer" });

    expect(
      __test_areTaskCardPropsEqual(
        { task: base, onOpenDetail: noop, addToast: noop } as any,
        { task: same, onOpenDetail: noop, addToast: noop } as any,
      ),
    ).toBe(true);
  });
});
