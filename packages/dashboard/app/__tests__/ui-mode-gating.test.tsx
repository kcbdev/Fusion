import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import {
  GATED_SURFACES,
  isAdvancedSurface,
  isSurfaceVisibleInMode,
  isPluginSurfaceId,
} from "../ui-mode";
import { GatedViewRedirectBanner } from "../components/GatedViewRedirectBanner";

// ── 1. Invariant: pin the gated-surface list ───────────────────────────────────
//
// This list is the contract. Adding/removing a gated surface MUST update both
// GATED_SURFACES and this expected list (drift turns the build red), guarding
// against silent multi-surface registration drift.
const EXPECTED_GATED_SURFACES = [
  "missions",
  "graph",
  "traits-panel",
  "custom-fields-panel",
  "per-task-agent-model",
  "branch-group-management",
  "plugin-development",
  "worktrees",
  "agent-permissions",
  "node-routing",
  "experimental",
  "prompts",
] as const;

describe("ui-mode predicate", () => {
  it("INVARIANT: GATED_SURFACES matches the enumerated expected list exactly", () => {
    expect([...GATED_SURFACES]).toEqual([...EXPECTED_GATED_SURFACES]);
  });

  it("isAdvancedSurface gates the enumerated built-in/section surfaces", () => {
    for (const surface of EXPECTED_GATED_SURFACES) {
      expect(isAdvancedSurface(surface)).toBe(true);
    }
  });

  it("non-gated surfaces are not advanced-only", () => {
    for (const surface of ["board", "list", "chat", "documents", "mailbox", "agents"]) {
      expect(isAdvancedSurface(surface)).toBe(false);
    }
  });

  it("plugin views default to advanced-only when undeclared and visible when declared", () => {
    const undeclared = "plugin:some-plugin:view";
    const declared = "plugin:some-plugin:view";
    expect(isPluginSurfaceId(undeclared)).toBe(true);
    // Undeclared (simpleMode undefined) → advanced-only.
    expect(isAdvancedSurface(undeclared)).toBe(true);
    expect(isAdvancedSurface(undeclared, false)).toBe(true);
    // Declared simpleMode: true → allowed in simple mode.
    expect(isAdvancedSurface(declared, true)).toBe(false);
  });

  it("isSurfaceVisibleInMode shows everything in advanced and gates in simple", () => {
    expect(isSurfaceVisibleInMode("missions", "advanced")).toBe(true);
    expect(isSurfaceVisibleInMode("missions", "simple")).toBe(false);
    expect(isSurfaceVisibleInMode("board", "simple")).toBe(true);
    // Plugin views: declared simpleMode survives simple mode.
    expect(isSurfaceVisibleInMode("plugin:p:v", "simple", true)).toBe(true);
    expect(isSurfaceVisibleInMode("plugin:p:v", "simple", undefined)).toBe(false);
  });
});

// ── 2. Deep-link redirect banner ───────────────────────────────────────────────

describe("GatedViewRedirectBanner", () => {
  it("names the gated view and offers a single switch-to-advanced action", () => {
    const onSwitch = vi.fn();
    render(<GatedViewRedirectBanner viewLabel="Missions" onSwitchToAdvanced={onSwitch} />);

    // Names the gated view.
    expect(screen.getByTestId("gated-view-redirect-banner").textContent).toContain("Missions");
    // Non-dismissible: there is no dismiss/close control, only the switch action.
    const switchBtn = screen.getByTestId("gated-view-redirect-switch");
    expect(switchBtn).toBeTruthy();
    fireEvent.click(switchBtn);
    expect(onSwitch).toHaveBeenCalledTimes(1);
  });
});

// ── 3. Header navigation gating ────────────────────────────────────────────────

const fetchBoardWorkflowsMock = vi.fn();
const fetchGlobalSettingsMock = vi.fn();

// Single consolidated api mock (vitest hoists vi.mock; one per module path).
vi.mock("../api", () => ({
  fetchScripts: vi.fn().mockResolvedValue([]),
  fetchWorkflowSteps: vi.fn().mockResolvedValue([]),
  fetchBoardWorkflows: (...args: unknown[]) => fetchBoardWorkflowsMock(...args),
  promoteTask: vi.fn().mockResolvedValue({}),
  // TaskCard imports:
  fetchTaskDetail: vi.fn(),
  uploadAttachment: vi.fn(),
  fetchMission: vi.fn(),
  fetchAgent: vi.fn(),
  fetchAgents: vi.fn(),
  fetchGlobalSettings: (...args: unknown[]) => fetchGlobalSettingsMock(...args),
  updateGlobalSettings: vi.fn().mockResolvedValue({}),
  getBoardTypes: vi.fn().mockResolvedValue({ types: [] }),
}));

import { Header } from "../components/Header";

const noop = () => {};

function renderHeader(props: Record<string, unknown> = {}) {
  return render(
    <Header
      onOpenSettings={noop}
      onOpenGitHubImport={noop}
      view="board"
      onChangeView={noop}
      {...props}
    />,
  );
}

describe("Header nav gating", () => {
  it("hides the missions button in simple mode", () => {
    renderHeader({ uiMode: "simple" });
    expect(screen.queryByLabelText("Missions view")).toBeNull();
  });

  it("shows the missions button in advanced mode", () => {
    renderHeader({ uiMode: "advanced" });
    expect(screen.getByLabelText("Missions view")).toBeTruthy();
  });
});

// ── 4. TaskCard chrome suppression (R23) ───────────────────────────────────────

// NOTE: lucide-react is intentionally NOT mocked — it renders real SVGs fine in
// jsdom (see tablet-header-controls.test). A catch-all Proxy mock can deadlock
// module interop, and a partial mock would crash on unlisted icons.

vi.mock("../components/ProviderIcon", () => ({
  ProviderIcon: () => null,
}));
vi.mock("../components/PrCreateModal", () => ({
  PrCreateModal: () => null,
}));
vi.mock("../hooks/useTaskDiffStats", () => ({
  useTaskDiffStats: () => ({ stats: null, loading: false }),
}));
vi.mock("../hooks/useBadgeWebSocket", () => ({
  useBadgeWebSocket: () => ({
    badgeUpdates: new Map(),
    isConnected: true,
    subscribeToBadge: vi.fn(),
    unsubscribeFromBadge: vi.fn(),
  }),
}));
vi.mock("../hooks/useBatchBadgeFetch", () => ({
  getFreshBatchData: () => null,
}));
vi.mock("../hooks/useConfirm", () => ({
  useConfirm: () => ({ confirm: vi.fn(), confirmWithChoice: vi.fn() }),
}));

import { TaskCard } from "../components/TaskCard";
import type { Task } from "@fusion/core";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "FN-001",
    title: "Test task",
    column: "in-progress",
    status: undefined as never,
    steps: [],
    dependencies: [],
    description: "",
    branch: "feature/my-work",
    baseBranch: "develop",
    ...overrides,
  } as Task;
}

describe("TaskCard chrome suppression (R23)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders branch chrome in advanced mode", () => {
    render(<TaskCard task={makeTask()} uiMode="advanced" onOpenDetail={noop} addToast={noop} />);
    expect(screen.getByText("feature/my-work")).toBeTruthy();
  });

  it("suppresses branch chrome in simple mode", () => {
    render(<TaskCard task={makeTask()} uiMode="simple" onOpenDetail={noop} addToast={noop} />);
    expect(screen.queryByText("feature/my-work")).toBeNull();
  });

  it("CRITICAL: still surfaces the stuck/needs-attention indicator in simple mode", () => {
    // A stuck in-progress task (updatedAt older than the stuck timeout) must still
    // raise its indicator on the card — suppressing branch chrome must never hide
    // a task that needs the user's git decision.
    const stuckTask = makeTask({
      column: "in-progress",
      status: "queued",
      updatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });
    render(
      <TaskCard
        task={stuckTask}
        uiMode="simple"
        taskStuckTimeoutMs={1000}
        lastFetchTimeMs={Date.now()}
        onOpenDetail={noop}
        addToast={noop}
      />,
    );
    expect(screen.getAllByText("Stuck").length).toBeGreaterThan(0);
    // Branch chrome is still suppressed alongside the preserved indicator.
    expect(screen.queryByText("feature/my-work")).toBeNull();
  });
});

// ── 5. Degraded board read-only + affordance ───────────────────────────────────

vi.mock("../components/Column", () => ({
  Column: ({ column, canDropTask }: { column: string; canDropTask?: (id: string) => string | null }) => (
    <div data-testid={`column-${column}`} data-can-drop={canDropTask ? canDropTask("FN-001") ?? "ok" : "no-handler"} />
  ),
}));
vi.mock("../components/BoardSwitcher", () => ({
  BoardSwitcher: () => <div data-testid="board-switcher" />,
}));
vi.mock("../hooks/useBlockerFanout", () => ({
  useBlockerFanout: () => new Map(),
}));
vi.mock("../sse-bus", () => ({
  subscribeSse: () => () => {},
}));

import { Board } from "../components/Board";

const DEGRADED_COLUMNS = [
  { id: "todo", name: "Todo", flags: { hold: true } },
  { id: "in-progress", name: "In progress", flags: { countsTowardWip: true } },
  { id: "done", name: "Done", flags: { complete: true } },
];

function boardPayload(linear: boolean) {
  return {
    boards: [{ id: "board-default", name: "Default", description: "", requirePlanApproval: false, ordering: 0 }],
    boardPayloads: {
      "board-default": { columns: DEGRADED_COLUMNS, team: {}, taskIds: [], linear },
    },
    defaultBoardId: "board-default",
  };
}

function renderBoard(props: Record<string, unknown> = {}) {
  return render(
    <Board
      tasks={[]}
      maxConcurrent={2}
      onMoveTask={vi.fn().mockResolvedValue({})}
      onOpenDetail={noop}
      addToast={noop}
      onNewTask={noop}
      autoMerge={false}
      onToggleAutoMerge={noop}
      {...props}
    />,
  );
}

describe("Degraded board read-only (AE7)", () => {
  beforeEach(() => {
    fetchBoardWorkflowsMock.mockReset();
    try {
      window.localStorage.clear();
    } catch {
      /* jsdom */
    }
  });

  it("renders read-only with an open-in-advanced affordance for a non-linear board in simple mode", async () => {
    fetchBoardWorkflowsMock.mockResolvedValue(boardPayload(false));
    const onSwitch = vi.fn();
    renderBoard({ uiMode: "simple", onSwitchToAdvancedMode: onSwitch });

    const banner = await screen.findByTestId("board-degraded-banner");
    expect(banner).toBeTruthy();
    const affordance = screen.getByTestId("board-degraded-open-advanced");
    fireEvent.click(affordance);
    expect(onSwitch).toHaveBeenCalledTimes(1);

    // Tasks keep rendering (columns still mount) but drops are rejected (read-only).
    const todo = await screen.findByTestId("column-todo");
    expect(todo.getAttribute("data-can-drop")).toBe("uiMode.degradedReadOnly");
  });

  it("does NOT degrade a non-linear board in advanced mode", async () => {
    fetchBoardWorkflowsMock.mockResolvedValue(boardPayload(false));
    renderBoard({ uiMode: "advanced" });
    await screen.findByTestId("board-switcher");
    expect(screen.queryByTestId("board-degraded-banner")).toBeNull();
  });

  it("does NOT degrade a linear board in simple mode", async () => {
    fetchBoardWorkflowsMock.mockResolvedValue(boardPayload(true));
    renderBoard({ uiMode: "simple" });
    await screen.findByTestId("board-switcher");
    expect(screen.queryByTestId("board-degraded-banner")).toBeNull();
  });
});

// ── 6. uiMode hydration race in deep-link gating (P2) ───────────────────────────
//
// useUiMode initializes from the localStorage cache (default "simple") and
// hydrates the canonical value from backend global settings async. The App
// deep-link gating effect must NOT redirect while hydration is in flight — doing
// so would bounce a legitimate deep-link to an advanced view based on the stale
// cached default. This harness reproduces the App gating effect's hydration
// guard against the real useUiMode hook.

import { useUiMode } from "../hooks/useUiMode";

function GatingHarness({ taskView }: { taskView: string }) {
  const { uiMode, isHydrating } = useUiMode();
  const [redirected, setRedirected] = React.useState(false);

  React.useEffect(() => {
    // Mirrors App.tsx's gating effect: skip while hydrating.
    if (isHydrating) return;
    if (uiMode !== "simple") return;
    if (isAdvancedSurface(taskView)) {
      setRedirected(true);
    }
  }, [taskView, uiMode, isHydrating]);

  return (
    <div
      data-testid="gating-harness"
      data-redirected={redirected ? "yes" : "no"}
      data-hydrating={isHydrating ? "yes" : "no"}
    />
  );
}

describe("uiMode hydration-race gating (P2)", () => {
  beforeEach(() => {
    fetchGlobalSettingsMock.mockReset();
    try {
      window.localStorage.setItem("kb-dashboard-ui-mode", "simple");
    } catch {
      /* jsdom */
    }
  });

  afterEach(() => {
    try {
      window.localStorage.clear();
    } catch {
      /* jsdom */
    }
  });

  it("does NOT redirect a deep-link to a gated view while hydrating", async () => {
    // Hydration never resolves within this assertion window.
    let resolveSettings: (v: unknown) => void = () => {};
    fetchGlobalSettingsMock.mockReturnValue(
      new Promise((resolve) => {
        resolveSettings = resolve;
      }),
    );

    render(<GatingHarness taskView="missions" />);

    const harness = screen.getByTestId("gating-harness");
    // While hydrating, the gating effect is suppressed even though the cached
    // value is "simple" and "missions" is a gated surface.
    expect(harness.getAttribute("data-hydrating")).toBe("yes");
    expect(harness.getAttribute("data-redirected")).toBe("no");

    // Let the pending promise settle to advanced so the unmount is clean.
    resolveSettings({ uiMode: "advanced" });
    await waitFor(() =>
      expect(harness.getAttribute("data-hydrating")).toBe("no"),
    );
  });

  it("redirects a deep-link to a gated view after hydration resolves to simple", async () => {
    fetchGlobalSettingsMock.mockResolvedValue({ uiMode: "simple" });

    render(<GatingHarness taskView="missions" />);

    const harness = screen.getByTestId("gating-harness");
    await waitFor(() =>
      expect(harness.getAttribute("data-hydrating")).toBe("no"),
    );
    await waitFor(() =>
      expect(harness.getAttribute("data-redirected")).toBe("yes"),
    );
  });
});
