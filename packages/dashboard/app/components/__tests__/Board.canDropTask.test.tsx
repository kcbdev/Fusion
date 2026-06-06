// Board-level coverage of the canDropTask drag pre-check (R17), board-scoped (U10).
//
// canDropTask is an internal Board closure passed down to each <Column> (already
// bound to that column's id). With boards as the universal container there is no
// cross-lane workflow-mismatch branch anymore — a card stays on its board while
// dragging between columns. We mock <Column> to CAPTURE the bound closures and
// drive the remaining branches:
//   - unknown target column      → "board.rejection.unknownColumn"
//   - full wip column (>= max)   → "board.rejection.capacityExhausted"
//   - valid under-capacity drop  → null (allowed)

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import type { Task } from "@fusion/core";
import { Board } from "../Board";

vi.mock("../../hooks/useBatchBadgeFetch", () => ({
  useBatchBadgeFetch: vi.fn(() => ({
    fetchBatch: vi.fn(),
    isLoading: false,
    lastFetchTime: null,
    getBatchData: vi.fn(),
  })),
}));

const fetchBoardWorkflowsMock = vi.fn();
vi.mock("../../api", () => ({
  fetchWorkflowSteps: vi.fn().mockResolvedValue([]),
  fetchBoardWorkflows: (...args: unknown[]) => fetchBoardWorkflowsMock(...args),
  promoteTask: vi.fn().mockResolvedValue({}),
  getBoardTypes: vi.fn().mockResolvedValue({ types: [{ id: "standard" }] }),
}));

vi.mock("../../sse-bus", () => ({
  subscribeSse: vi.fn(() => () => {}),
}));

// Capture the column-bound canDropTask closures Board passes to each Column.
type BoundCanDrop = (taskId: string) => string | null;
const capturedByColumn: Record<string, BoundCanDrop> = {};
vi.mock("../Column", () => ({
  Column: (props: { column: string; canDropTask?: BoundCanDrop }) => {
    if (props.canDropTask) capturedByColumn[props.column] = props.canDropTask;
    return <div data-testid={`column-${props.column}`} />;
  },
}));

// builtin:coding columns (in-progress counts toward wip; todo does not).
const defaultColumns = [
  { id: "triage", name: "Triage", flags: {} },
  { id: "todo", name: "Todo", flags: {} },
  { id: "in-progress", name: "In Progress", flags: { countsTowardWip: true } },
  { id: "in-review", name: "In Review", flags: {} },
  { id: "done", name: "Done", flags: { complete: true } },
];

function makeTask(id: string, column: string): Task {
  const now = new Date().toISOString();
  return {
    id,
    description: id,
    column,
    dependencies: [],
    createdAt: now,
    updatedAt: now,
    log: [],
  } as unknown as Task;
}

function boardProps(overrides: Record<string, unknown> = {}) {
  return {
    tasks: [] as Task[],
    maxConcurrent: 2,
    onMoveTask: () => Promise.resolve({} as never),
    onOpenDetail: () => {},
    addToast: () => {},
    onQuickCreate: () => Promise.resolve({} as never),
    onNewTask: () => {},
    autoMerge: true,
    onToggleAutoMerge: () => {},
    globalPaused: false,
    ...overrides,
  };
}

async function renderAndCapture(tasks: Task[]) {
  fetchBoardWorkflowsMock.mockResolvedValue({
    boards: [{ id: "board-default", name: "Default", description: "", requirePlanApproval: false, ordering: 0 }],
    boardPayloads: { "board-default": { columns: defaultColumns, team: {}, taskIds: tasks.map((t) => t.id) } },
    defaultBoardId: "board-default",
  });
  await act(async () => {
    const props = boardProps({ tasks }) as unknown as React.ComponentProps<typeof Board>;
    render(<Board {...props} />);
    await Promise.resolve();
  });
  expect(capturedByColumn["in-progress"]).toBeTypeOf("function");
}

describe("Board canDropTask pre-check (board-scoped, U10)", () => {
  beforeEach(() => {
    for (const k of Object.keys(capturedByColumn)) delete capturedByColumn[k];
    fetchBoardWorkflowsMock.mockReset();
    try { window.localStorage.clear(); } catch { /* jsdom */ }
  });

  it("full wip column (occupants >= maxConcurrent) → capacityExhausted", async () => {
    const tasks = [
      makeTask("FN-1", "todo"),
      makeTask("FN-2", "in-progress"),
      makeTask("FN-3", "in-progress"),
    ];
    await renderAndCapture(tasks);
    expect(capturedByColumn["in-progress"]("FN-1")).toBe("board.rejection.capacityExhausted");
  });

  it("valid drop under capacity → allowed (null)", async () => {
    const tasks = [makeTask("FN-1", "todo"), makeTask("FN-2", "in-progress")];
    await renderAndCapture(tasks);
    // One free in-progress slot (maxConcurrent 2, one occupant).
    expect(capturedByColumn["in-progress"]("FN-1")).toBeNull();
    // Dropping into a non-wip column (todo → in-review) is also allowed.
    expect(capturedByColumn["in-review"]("FN-1")).toBeNull();
  });
});
