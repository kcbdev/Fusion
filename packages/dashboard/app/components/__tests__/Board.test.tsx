import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { Board } from "../Board";

import type { Task } from "@fusion/core";

const fetchBatchMock = vi.fn();

vi.mock("../../hooks/useBatchBadgeFetch", () => ({
  useBatchBadgeFetch: vi.fn(() => ({
    fetchBatch: fetchBatchMock,
    isLoading: false,
    lastFetchTime: null,
    getBatchData: vi.fn(),
  })),
}));

// Default board columns mirror the legacy builtin:coding pipeline so the
// board-scoped board renders the same six columns today's UI showed.
const DEFAULT_COLUMNS = [
  { id: "triage", name: "Triage", flags: { intake: true } },
  { id: "todo", name: "Todo", flags: { hold: true } },
  { id: "in-progress", name: "In progress", flags: { countsTowardWip: true } },
  { id: "in-review", name: "In review", flags: { mergeBlocker: true } },
  { id: "done", name: "Done", flags: { complete: true } },
  { id: "archived", name: "Archived", flags: { archived: true } },
];

const VISIBLE_COLUMNS = ["triage", "todo", "in-progress", "in-review", "done"];
const ALL_COLUMNS = [...VISIBLE_COLUMNS, "archived"];

function singleBoardPayload(taskIds: string[] = [], team: Record<string, { agentId: string; agentName: string }> = {}) {
  return {
    boards: [
      { id: "board-default", name: "Default", description: "", requirePlanApproval: false, ordering: 0 },
    ],
    boardPayloads: {
      "board-default": { columns: DEFAULT_COLUMNS, team, taskIds },
    },
    defaultBoardId: "board-default",
  };
}

const fetchBoardWorkflowsMock = vi.fn().mockResolvedValue(singleBoardPayload());
const promoteTaskMock = vi.fn().mockResolvedValue({});

vi.mock("../../api", () => ({
  fetchWorkflowSteps: vi.fn().mockResolvedValue([
    { id: "WS-003", name: "Accessibility Audit", enabled: true },
  ]),
  fetchBoardWorkflows: (...args: unknown[]) => fetchBoardWorkflowsMock(...args),
  promoteTask: (...args: unknown[]) => promoteTaskMock(...args),
  // U13: the board-type availability probe (CE board type gated on plugin install).
  getBoardTypes: vi.fn().mockResolvedValue({ types: [{ id: "standard" }] }),
}));

// Capture SSE event handlers registered via subscribeSse so tests can simulate
// server-pushed events without a real EventSource.
const sseHandlers: Record<string, (event?: unknown) => void> = {};
const subscribeSseMock = vi.fn(
  (_url: string, opts: { events?: Record<string, (event?: unknown) => void> }) => {
    for (const [name, handler] of Object.entries(opts.events ?? {})) {
      sseHandlers[name] = handler;
    }
    return () => {};
  },
);
vi.mock("../../sse-bus", () => ({
  subscribeSse: (...args: unknown[]) => (subscribeSseMock as (...a: unknown[]) => () => void)(...args),
}));

const columnRenderCounts: Record<string, number> = {};

// Mock child Column so we only test Board's own rendering.
vi.mock("../Column", () => ({
  Column: React.memo(({ column, tasks, columnAgentName, onToggleCollapse, favoriteProviders, favoriteModels, onToggleFavorite, onToggleModelFavorite, isSearchActive, workflowStepNameLookup }: { column: string; tasks: Task[]; columnAgentName?: string; onToggleCollapse?: () => void; favoriteProviders?: string[]; favoriteModels?: string[]; onToggleFavorite?: (provider: string) => void; onToggleModelFavorite?: (modelId: string) => void; isSearchActive?: boolean; workflowStepNameLookup?: ReadonlyMap<string, string> }) => {
    columnRenderCounts[column] = (columnRenderCounts[column] ?? 0) + 1;
    return (
      <div data-testid={`column-${column}`} data-column-agent={columnAgentName ?? ""} data-tasks={JSON.stringify(tasks)} data-favorite-providers={JSON.stringify(favoriteProviders ?? [])} data-favorite-models={JSON.stringify(favoriteModels ?? [])} data-has-toggle-favorite={onToggleFavorite ? "yes" : "no"} data-has-toggle-model-favorite={onToggleModelFavorite ? "yes" : "no"} data-is-search-active={isSearchActive ? "true" : "false"} data-workflow-lookup-size={String(workflowStepNameLookup?.size ?? 0)}>
        {onToggleCollapse && <button onClick={onToggleCollapse}>toggle-{column}</button>}
      </div>
    );
  }),
}));

beforeEach(() => {
  fetchBatchMock.mockReset();
  promoteTaskMock.mockClear();
  subscribeSseMock.mockClear();
  for (const key of Object.keys(sseHandlers)) delete sseHandlers[key];
  fetchBoardWorkflowsMock.mockReset();
  fetchBoardWorkflowsMock.mockResolvedValue(singleBoardPayload());
  try {
    window.localStorage.clear();
  } catch {
    /* jsdom localStorage */
  }
  for (const key of Object.keys(columnRenderCounts)) {
    delete columnRenderCounts[key];
  }
});

function createBoardProps(overrides = {}) {
  return {
    tasks: [],
    maxConcurrent: 2,
    onMoveTask: () => Promise.resolve({} as Task),
    onOpenDetail: () => {},
    addToast: () => {},
    onQuickCreate: () => Promise.resolve({} as Task),
    onNewTask: () => {},
    autoMerge: true,
    onToggleAutoMerge: () => {},
    globalPaused: false,
    ...overrides,
  };
}

function renderBoard(props = {}) {
  return render(<Board {...createBoardProps(props)} />);
}

/** Wait for the board-scoped payload to resolve and the board to render. */
async function renderBoardAndSettle(props = {}) {
  const result = renderBoard(props);
  await waitFor(() => expect(screen.getByTestId("column-todo")).toBeDefined());
  return result;
}

describe("Board (board-scoped, U10)", () => {
  it("renders a <main> element with class 'board'", async () => {
    await renderBoardAndSettle();
    const main = screen.getByRole("main");
    expect(main).toBeDefined();
    expect(main.className).toContain("board");
  });

  it("renders with id='board' for scroll targeting", async () => {
    await renderBoardAndSettle();
    const main = screen.getByRole("main");
    expect(main.id).toBe("board");
  });

  it("FN-4380: does not eagerly fetch GitHub badge status on board mount", async () => {
    const tasksWithBadges: Task[] = [
      {
        id: "FN-PR-1",
        title: "Task with PR badge",
        description: "Has prInfo",
        column: "todo",
        dependencies: [],
        steps: [],
        currentStep: 0,
        log: [],
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
        prInfo: { number: 123, owner: "runfusion", repo: "fusion" } as Task["prInfo"],
      },
    ];

    await renderBoardAndSettle({ tasks: tasksWithBadges });
    expect(fetchBatchMock).not.toHaveBeenCalled();
  });

  it("renders the active board's columns (no lane elements anywhere)", async () => {
    await renderBoardAndSettle();
    for (const col of ALL_COLUMNS) {
      expect(screen.getByTestId(`column-${col}`)).toBeDefined();
    }
    // Zero lane elements: the lane concept is gone.
    expect(screen.queryByTestId(/^lane-/)).toBeNull();
    expect(document.querySelector(".lane")).toBeNull();
  });

  it("renders a board switcher above the board", async () => {
    await renderBoardAndSettle();
    expect(screen.getByTestId("board-switcher")).toBeDefined();
    expect(screen.getByTestId("board-switcher-tab-board-default")).toBeDefined();
  });

  it("renders the staffed agent name in the column header (team map)", async () => {
    fetchBoardWorkflowsMock.mockResolvedValue(
      singleBoardPayload([], { "in-progress": { agentId: "a1", agentName: "Ada" } }),
    );
    await renderBoardAndSettle();
    await waitFor(() => {
      expect(screen.getByTestId("column-in-progress").getAttribute("data-column-agent")).toBe("Ada");
    });
    expect(screen.getByTestId("column-todo").getAttribute("data-column-agent")).toBe("");
  });

  it("homes tasks with no boardId to the default board", async () => {
    const tasks: Task[] = [
      mkTask({ id: "FN-1", column: "todo" }),
      mkTask({ id: "FN-2", column: "in-progress" }),
    ];
    await renderBoardAndSettle({ tasks });
    const todo = JSON.parse(screen.getByTestId("column-todo").getAttribute("data-tasks") || "[]") as Task[];
    expect(todo.map((t) => t.id)).toEqual(["FN-1"]);
    const ip = JSON.parse(screen.getByTestId("column-in-progress").getAttribute("data-tasks") || "[]") as Task[];
    expect(ip.map((t) => t.id)).toEqual(["FN-2"]);
  });

  it("homes null-boardId tasks on the resolved board when defaultBoardId is null", async () => {
    // Regression: with defaultBoardId null, a null-boardId (legacy) task used to
    // resolve to homeBoardId=null and be excluded from every board silently.
    fetchBoardWorkflowsMock.mockResolvedValue({
      boards: [
        { id: "board-default", name: "Default", description: "", requirePlanApproval: false, ordering: 0 },
      ],
      boardPayloads: {
        "board-default": { columns: DEFAULT_COLUMNS, team: {}, taskIds: [] },
      },
      defaultBoardId: null,
    });
    const tasks: Task[] = [mkTask({ id: "FN-LEGACY", column: "todo" })];
    await renderBoardAndSettle({ tasks });
    const todo = JSON.parse(screen.getByTestId("column-todo").getAttribute("data-tasks") || "[]") as Task[];
    expect(todo.map((t) => t.id)).toEqual(["FN-LEGACY"]);
  });

  it("buckets unknown-column tasks into the first column on a board without triage", async () => {
    // CE-like board: no triage column. A task whose column id isn't recognized
    // used to bucket to a hardcoded "triage" and vanish; it should now land in
    // the board's intake/first column.
    const CE_COLUMNS = [
      { id: "backlog", name: "Backlog", flags: { intake: true } },
      { id: "doing", name: "Doing", flags: { countsTowardWip: true } },
      { id: "done", name: "Done", flags: { complete: true } },
    ];
    fetchBoardWorkflowsMock.mockResolvedValue({
      boards: [
        { id: "board-default", name: "CE", description: "", requirePlanApproval: false, ordering: 0 },
      ],
      boardPayloads: {
        "board-default": { columns: CE_COLUMNS, team: {}, taskIds: [] },
      },
      defaultBoardId: "board-default",
    });
    const tasks: Task[] = [mkTask({ id: "FN-UNK", column: "weird-col" as Task["column"] })];
    const result = renderBoard({ tasks });
    await waitFor(() => expect(screen.getByTestId("column-backlog")).toBeDefined());
    const backlog = JSON.parse(screen.getByTestId("column-backlog").getAttribute("data-tasks") || "[]") as Task[];
    expect(backlog.map((t) => t.id)).toEqual(["FN-UNK"]);
    result.unmount();
  });

  it("forwards board-level workflow name lookup to columns", async () => {
    await renderBoardAndSettle();
    await waitFor(() => {
      for (const col of VISIBLE_COLUMNS) {
        expect(screen.getByTestId(`column-${col}`).getAttribute("data-workflow-lookup-size")).toBe("1");
      }
    });
  });

  it("renders the board element as a <main> tag (semantic structure)", async () => {
    await renderBoardAndSettle();
    expect(screen.getByRole("main").tagName).toBe("MAIN");
  });

  const mkTask = (overrides: Partial<Task> & { id: string }): Task => ({
    title: overrides.id,
    description: "d",
    column: "todo",
    dependencies: [],
    steps: [],
    currentStep: 0,
    log: [],
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  });

  describe("multi-board switcher (U10)", () => {
    function twoBoardPayload() {
      return {
        boards: [
          { id: "board-a", name: "Alpha", description: "", requirePlanApproval: false, ordering: 0 },
          { id: "board-b", name: "Beta", description: "", requirePlanApproval: false, ordering: 1 },
        ],
        boardPayloads: {
          "board-a": { columns: DEFAULT_COLUMNS, team: {}, taskIds: ["FN-A"] },
          "board-b": { columns: DEFAULT_COLUMNS, team: {}, taskIds: ["FN-B"] },
        },
        defaultBoardId: "board-a",
      };
    }

    it("renders two boards via the switcher and shows the default board's tasks", async () => {
      fetchBoardWorkflowsMock.mockResolvedValue(twoBoardPayload());
      const tasks = [mkTask({ id: "FN-A", boardId: "board-a" }), mkTask({ id: "FN-B", boardId: "board-b" })];
      await renderBoardAndSettle({ tasks });
      expect(screen.getByTestId("board-switcher-tab-board-a")).toBeDefined();
      expect(screen.getByTestId("board-switcher-tab-board-b")).toBeDefined();
      // Default board (board-a) is active and shows only its task.
      const todoA = JSON.parse(screen.getByTestId("column-todo").getAttribute("data-tasks") || "[]") as Task[];
      expect(todoA.map((t) => t.id)).toEqual(["FN-A"]);
    });

    it("switches the rendered board on tab click and persists the selection", async () => {
      fetchBoardWorkflowsMock.mockResolvedValue(twoBoardPayload());
      const tasks = [mkTask({ id: "FN-A", boardId: "board-a" }), mkTask({ id: "FN-B", boardId: "board-b" })];
      await renderBoardAndSettle({ tasks, projectId: "proj-1" });

      fireEvent.click(screen.getByTestId("board-switcher-tab-board-b"));
      await waitFor(() => {
        const todoB = JSON.parse(screen.getByTestId("column-todo").getAttribute("data-tasks") || "[]") as Task[];
        expect(todoB.map((t) => t.id)).toEqual(["FN-B"]);
      });
      expect(window.localStorage.getItem("kb-dashboard-selected-board:proj-1")).toBe("board-b");
    });

    it("restores the persisted board on load", async () => {
      window.localStorage.setItem("kb-dashboard-selected-board:proj-1", "board-b");
      fetchBoardWorkflowsMock.mockResolvedValue(twoBoardPayload());
      const tasks = [mkTask({ id: "FN-A", boardId: "board-a" }), mkTask({ id: "FN-B", boardId: "board-b" })];
      await renderBoardAndSettle({ tasks, projectId: "proj-1" });
      await waitFor(() => {
        const todo = JSON.parse(screen.getByTestId("column-todo").getAttribute("data-tasks") || "[]") as Task[];
        expect(todo.map((t) => t.id)).toEqual(["FN-B"]);
      });
      expect(screen.getByTestId("board-switcher-tab-board-b").getAttribute("data-active")).toBe("true");
    });

    it("falls back to defaultBoardId when the persisted board no longer exists", async () => {
      window.localStorage.setItem("kb-dashboard-selected-board:proj-1", "board-gone");
      fetchBoardWorkflowsMock.mockResolvedValue(twoBoardPayload());
      await renderBoardAndSettle({ projectId: "proj-1" });
      await waitFor(() => {
        expect(screen.getByTestId("board-switcher-tab-board-a").getAttribute("data-active")).toBe("true");
      });
    });
  });

  describe("SSE / fetch behavior", () => {
    it("re-fetches the board-scoped payload on workflow:updated", async () => {
      await renderBoardAndSettle({ projectId: "proj-1" });
      await waitFor(() => expect(fetchBoardWorkflowsMock).toHaveBeenCalledTimes(1));
      expect(subscribeSseMock).toHaveBeenCalled();
      expect(typeof sseHandlers["workflow:updated"]).toBe("function");
      await act(async () => {
        sseHandlers["workflow:updated"]?.();
      });
      await waitFor(() => expect(fetchBoardWorkflowsMock).toHaveBeenCalledTimes(2));
    });

    it("re-fetches the board-scoped payload on board:updated", async () => {
      await renderBoardAndSettle({ projectId: "proj-1" });
      await waitFor(() => expect(fetchBoardWorkflowsMock).toHaveBeenCalledTimes(1));
      expect(typeof sseHandlers["board:updated"]).toBe("function");
      await act(async () => {
        sseHandlers["board:updated"]?.();
      });
      await waitFor(() => expect(fetchBoardWorkflowsMock).toHaveBeenCalledTimes(2));
    });
  });

  describe("fetch failure", () => {
    it("shows the switcher retry affordance when the boards fetch fails", async () => {
      fetchBoardWorkflowsMock.mockRejectedValueOnce(new Error("offline"));
      renderBoard({ projectId: "proj-1" });
      await waitFor(() => expect(screen.getByTestId("board-switcher-failed")).toBeDefined());
      // Retry succeeds → board renders.
      fetchBoardWorkflowsMock.mockResolvedValueOnce(singleBoardPayload());
      fireEvent.click(screen.getByTestId("board-switcher-retry"));
      await waitFor(() => expect(screen.getByTestId("column-todo")).toBeDefined());
    });
  });

  describe("search + sort plumbing", () => {
    it("renders server-filtered tasks (search) on the active board", async () => {
      const tasks: Task[] = [mkTask({ id: "FN-002", column: "todo" })];
      await renderBoardAndSettle({ tasks, searchQuery: "FN-002" });
      const todo = JSON.parse(screen.getByTestId("column-todo").getAttribute("data-tasks") || "[]") as Task[];
      expect(todo.map((t) => t.id)).toEqual(["FN-002"]);
      for (const col of VISIBLE_COLUMNS) {
        expect(screen.getByTestId(`column-${col}`).getAttribute("data-is-search-active")).toBe("true");
      }
    });

    it("orders todo by priority before age", async () => {
      const tasks: Task[] = [
        mkTask({ id: "FN-003", column: "todo", priority: "low", createdAt: "2024-01-01T08:00:00.000Z" }),
        mkTask({ id: "FN-001", column: "todo", priority: "urgent", createdAt: "2024-01-01T10:00:00.000Z" }),
        mkTask({ id: "FN-002", column: "todo", priority: "high", createdAt: "2024-01-01T07:00:00.000Z" }),
      ];
      await renderBoardAndSettle({ tasks });
      const todo = JSON.parse(screen.getByTestId("column-todo").getAttribute("data-tasks") || "[]") as Task[];
      expect(todo.map((t) => t.id)).toEqual(["FN-001", "FN-002", "FN-003"]);
    });
  });

  describe("favorite model prop forwarding (FN-770)", () => {
    it("forwards favoriteProviders and favoriteModels to all columns", async () => {
      const favoriteProviders = ["anthropic"];
      const favoriteModels = ["claude-sonnet-4-5"];
      await renderBoardAndSettle({
        favoriteProviders,
        favoriteModels,
        onToggleFavorite: vi.fn(),
        onToggleModelFavorite: vi.fn(),
      });
      for (const col of VISIBLE_COLUMNS) {
        const el = screen.getByTestId(`column-${col}`);
        expect(el.getAttribute("data-favorite-providers")).toBe(JSON.stringify(favoriteProviders));
        expect(el.getAttribute("data-has-toggle-favorite")).toBe("yes");
      }
    });
  });
});
