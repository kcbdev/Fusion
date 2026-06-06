import React, { useState } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { Board } from "../Board";
import { PageErrorBoundary } from "../ErrorBoundary";
import type { Task } from "@fusion/core";

vi.mock("../../api", () => ({
  fetchBoardWorkflows: vi.fn().mockResolvedValue({
    boards: [{ id: "board-default", name: "Default", description: "", requirePlanApproval: false, ordering: 0 }],
    boardPayloads: {
      "board-default": {
        columns: [
          { id: "triage", name: "Triage", flags: { intake: true } },
          { id: "todo", name: "To Do", flags: { hold: true } },
          { id: "in-progress", name: "In Progress", flags: { countsTowardWip: true } },
          { id: "in-review", name: "In Review", flags: { mergeBlocker: true } },
          { id: "done", name: "Done", flags: { complete: true } },
          { id: "archived", name: "Archived", flags: { archived: true } },
        ],
        team: {},
        taskIds: [],
      },
    },
    defaultBoardId: "board-default",
  }),
  promoteTask: vi.fn().mockResolvedValue({}),
  fetchWorkflowSteps: vi.fn().mockResolvedValue([]),
  getBoardTypes: vi.fn().mockResolvedValue({ types: [{ id: "standard" }] }),
}));

vi.mock("../../hooks/useBlockerFanout", () => ({
  useBlockerFanout: () => new Map(),
}));

vi.mock("../../hooks/useConfirm", () => ({
  useConfirm: () => ({ confirm: vi.fn() }),
}));

vi.mock("../../hooks/useFlashOnIncrease", () => ({
  useFlashOnIncrease: () => false,
}));

vi.mock("../PluginSlot", () => ({
  PluginSlot: () => null,
}));

vi.mock("../QuickEntryBox", () => ({
  QuickEntryBox: () => null,
}));

vi.mock("../TaskCard", () => ({
  TaskCard: ({ task, autoMergeEnabled }: { task: Task; autoMergeEnabled?: boolean }) => {
    if (task.id === "FN-ERROR" && autoMergeEnabled === false) {
      throw new Error("Auto-merge render failed");
    }
    return <div data-testid={`task-card-${task.id}`}>task:{task.id}:{String(autoMergeEnabled)}</div>;
  },
}));

vi.mock("../WorktreeGroup", () => ({
  WorktreeGroup: ({ label, autoMergeEnabled }: { label: string; autoMergeEnabled?: boolean }) => (
    <div data-testid={`worktree-group-${label}`}>worktree:{String(autoMergeEnabled)}</div>
  ),
}));

function ensureMatchMedia() {
  if (!window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn(),
    });
  }
}

function mockViewport(width: number) {
  ensureMatchMedia();
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
  return vi.spyOn(window, "matchMedia").mockImplementation((query: string) => ({
    matches: query === "(max-width: 768px)" ? width <= 768 : false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

function createVisualViewport(scale = 1) {
  const resizeListeners = new Set<() => void>();
  return {
    scale,
    addEventListener: vi.fn((event: string, listener: () => void) => {
      if (event === "resize") {
        resizeListeners.add(listener);
      }
    }),
    removeEventListener: vi.fn((event: string, listener: () => void) => {
      if (event === "resize") {
        resizeListeners.delete(listener);
      }
    }),
    dispatchResize: () => {
      for (const listener of [...resizeListeners]) {
        listener();
      }
    },
  };
}

function createTask(id: string, column: Task["column"]): Task {
  return {
    id,
    title: id,
    description: `${id} description`,
    column,
    status: column === "in-review" ? "in-review" : undefined,
    dependencies: [],
    steps: [],
    currentStep: 0,
    log: [],
    createdAt: "2026-06-03T00:00:00.000Z",
    updatedAt: "2026-06-03T00:00:00.000Z",
  } as Task;
}

function BaseBoardHarness({
  tasks,
  autoMerge,
  onToggleAutoMerge,
}: {
  tasks: Task[];
  autoMerge: boolean;
  onToggleAutoMerge: () => void | Promise<void>;
}) {
  return (
    <PageErrorBoundary>
      <Board
        tasks={tasks}
        maxConcurrent={2}
        onMoveTask={vi.fn(async () => ({} as Task))}
        onOpenDetail={vi.fn()}
        addToast={vi.fn()}
        onQuickCreate={vi.fn(async () => undefined)}
        onNewTask={vi.fn()}
        autoMerge={autoMerge}
        onToggleAutoMerge={onToggleAutoMerge}
        globalPaused={false}
      />
    </PageErrorBoundary>
  );
}

function BoardHarness({ tasks, initialAutoMerge = true }: { tasks: Task[]; initialAutoMerge?: boolean }) {
  const [autoMerge, setAutoMerge] = useState(initialAutoMerge);

  return (
    <BaseBoardHarness
      tasks={tasks}
      autoMerge={autoMerge}
      onToggleAutoMerge={() => setAutoMerge((current) => !current)}
    />
  );
}

function RollbackBoardHarness({ tasks }: { tasks: Task[] }) {
  const [autoMerge, setAutoMerge] = useState(true);

  return (
    <BaseBoardHarness
      tasks={tasks}
      autoMerge={autoMerge}
      onToggleAutoMerge={async () => {
        const previousAutoMerge = autoMerge;
        const nextAutoMerge = !previousAutoMerge;
        setAutoMerge(nextAutoMerge);

        try {
          await Promise.reject(new Error("network"));
        } catch {
          setAutoMerge(previousAutoMerge);
        }
      }}
    />
  );
}

function installAnimationFrame() {
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    setTimeout(() => cb(0), 0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
}

/** Flush the board-scoped payload fetch (U10) so columns render. Fake timers
 *  are active, so we drain the mocked-fetch microtasks under act. */
async function flushBoardLoad() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    vi.runOnlyPendingTimers();
  });
}

function expectBoardVisible() {
  expect(document.querySelector("main.board")).not.toBeNull();
  expect(screen.getByText("In Review")).toBeInTheDocument();
  expect(screen.queryByText("Something went wrong")).toBeNull();
}

describe("auto-merge toggle mobile blank regression", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps the mobile board visible after an Android viewport resize triggered by toggling auto-merge", async () => {
    const viewportSpy = mockViewport(375);
    const visualViewport = createVisualViewport(1);
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: visualViewport,
    });
    installAnimationFrame();

    render(<BoardHarness tasks={[createTask("FN-5936", "in-review")]} />);
    await flushBoardLoad();

    const board = document.querySelector("main.board") as HTMLElement;
    expect(screen.getByTestId("task-card-FN-5936")).toHaveTextContent("true");
    expectBoardVisible();

    act(() => {
      vi.runOnlyPendingTimers();
    });

    board.scrollLeft = 240;
    act(() => {
      visualViewport.dispatchResize();
      vi.runOnlyPendingTimers();
    });
    expect(board.scrollLeft).toBe(0);

    board.scrollLeft = 240;
    fireEvent.click(screen.getByRole("checkbox", { name: "Auto-merge" }));

    expect(screen.getByTestId("task-card-FN-5936")).toHaveTextContent("false");

    board.scrollLeft = 240;
    act(() => {
      visualViewport.dispatchResize();
      vi.runOnlyPendingTimers();
    });

    expectBoardVisible();
    expect(board.scrollLeft).toBe(0);
    viewportSpy.mockRestore();
  });

  it("round-trips auto-merge on mobile Android with an empty in-review column without blanking", async () => {
    const viewportSpy = mockViewport(375);
    const visualViewport = createVisualViewport(1);
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: visualViewport,
    });
    installAnimationFrame();

    render(<BoardHarness tasks={[]} />);
    await flushBoardLoad();
    const board = document.querySelector("main.board") as HTMLElement;

    act(() => {
      vi.runOnlyPendingTimers();
    });

    const toggle = screen.getByRole("checkbox", { name: "Auto-merge" });
    expect(toggle).toBeChecked();
    expectBoardVisible();

    fireEvent.click(toggle);
    expect(toggle).not.toBeChecked();
    board.scrollLeft = 180;
    act(() => {
      visualViewport.dispatchResize();
      vi.runOnlyPendingTimers();
    });
    expectBoardVisible();
    expect(board.scrollLeft).toBe(0);

    fireEvent.click(toggle);
    expect(toggle).toBeChecked();
    board.scrollLeft = 180;
    act(() => {
      visualViewport.dispatchResize();
      vi.runOnlyPendingTimers();
    });
    expectBoardVisible();
    expect(board.scrollLeft).toBe(0);
    viewportSpy.mockRestore();
  });

  it("keeps populated task-card and worktree surfaces visible when auto-merge toggles on mobile", async () => {
    const viewportSpy = mockViewport(375);
    const visualViewport = createVisualViewport(1);
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: visualViewport,
    });
    installAnimationFrame();

    render(
      <BoardHarness
        tasks={[
          createTask("FN-5936", "in-review"),
          createTask("FN-IP", "in-progress"),
        ]}
      />,
    );
    await flushBoardLoad();

    act(() => {
      vi.runOnlyPendingTimers();
    });

    // Board-scoped (U10): the board is always in workflow mode, so the
    // processing (countsTowardWip) column renders task cards directly rather
    // than the legacy worktree-grouped view. Both surfaces still reflect the
    // auto-merge toggle without blanking.
    expect(screen.getByTestId("task-card-FN-5936")).toHaveTextContent("true");
    expect(screen.getByTestId("task-card-FN-IP")).toHaveTextContent("true");

    fireEvent.click(screen.getByRole("checkbox", { name: "Auto-merge" }));

    expect(screen.getByTestId("task-card-FN-5936")).toHaveTextContent("false");
    expect(screen.getByTestId("task-card-FN-IP")).toHaveTextContent("false");
    expectBoardVisible();
    viewportSpy.mockRestore();
  });

  it("re-anchors on the mobile iOS pageshow path after toggling auto-merge", async () => {
    const viewportSpy = mockViewport(375);
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: createVisualViewport(1.1),
    });
    installAnimationFrame();

    render(<BoardHarness tasks={[createTask("FN-IOS", "in-review")]} />);
    await flushBoardLoad();
    const board = document.querySelector("main.board") as HTMLElement;

    act(() => {
      vi.runOnlyPendingTimers();
    });

    fireEvent.click(screen.getByRole("checkbox", { name: "Auto-merge" }));
    board.scrollLeft = 210;

    const pageShow = new Event("pageshow") as PageTransitionEvent;
    Object.defineProperty(pageShow, "persisted", { configurable: true, value: true });
    act(() => {
      window.dispatchEvent(pageShow);
      vi.runOnlyPendingTimers();
    });

    expectBoardVisible();
    expect(board.scrollLeft).toBe(0);
    viewportSpy.mockRestore();
  });

  it("keeps the board visible on tablet where the mobile stabilization effect is disabled", async () => {
    const viewportSpy = mockViewport(900);
    installAnimationFrame();

    render(<BoardHarness tasks={[createTask("FN-TABLET", "in-review")]} />);
    await flushBoardLoad();

    const toggle = screen.getByRole("checkbox", { name: "Auto-merge" });
    expect(toggle).toBeChecked();
    expectBoardVisible();

    fireEvent.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(screen.getByTestId("task-card-FN-TABLET")).toHaveTextContent("false");
    expectBoardVisible();
    viewportSpy.mockRestore();
  });

  it("keeps the board visible on desktop after toggling auto-merge", async () => {
    const viewportSpy = mockViewport(1280);
    installAnimationFrame();

    render(<BoardHarness tasks={[createTask("FN-DESKTOP", "in-review")]} />);
    await flushBoardLoad();

    fireEvent.click(screen.getByRole("checkbox", { name: "Auto-merge" }));

    expect(screen.getByTestId("task-card-FN-DESKTOP")).toHaveTextContent("false");
    expectBoardVisible();
    viewportSpy.mockRestore();
  });

  it("keeps the mobile board visible when the toggle rolls back after an update failure", async () => {
    const viewportSpy = mockViewport(375);
    const visualViewport = createVisualViewport(1);
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: visualViewport,
    });
    installAnimationFrame();

    render(<RollbackBoardHarness tasks={[createTask("FN-ROLLBACK", "in-review")]} />);
    await flushBoardLoad();

    const toggle = screen.getByRole("checkbox", { name: "Auto-merge" });
    expect(toggle).toBeChecked();

    await act(async () => {
      fireEvent.click(toggle);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(toggle).toBeChecked();
    expect(screen.getByTestId("task-card-FN-ROLLBACK")).toHaveTextContent("true");
    expectBoardVisible();
    viewportSpy.mockRestore();
  });

  it("shows a visible page error boundary fallback instead of a blank board when a board child throws", async () => {
    const viewportSpy = mockViewport(375);
    const visualViewport = createVisualViewport(1);
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: visualViewport,
    });
    installAnimationFrame();
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(<BoardHarness tasks={[createTask("FN-ERROR", "in-review")]} />);
    await flushBoardLoad();

    fireEvent.click(screen.getByRole("checkbox", { name: "Auto-merge" }));

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();

    consoleErrorSpy.mockRestore();
    viewportSpy.mockRestore();
  });
});
