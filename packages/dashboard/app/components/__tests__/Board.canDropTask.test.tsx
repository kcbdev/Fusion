// FN-1416/FN-6029: Board-level coverage of the canDropTask drag pre-check (R17).
//
// Board now passes one-argument per-column wrappers directly to <Column> in the
// selected-workflow rendering path, while <Lane> still adapts the canonical
// three-argument decision for multi-lane rendering. These tests exercise the
// pure Board decision seam directly so unrendered-column branches (especially
// unknownColumn) remain covered without stale Lane mocking.

import { describe, it, expect } from "vitest";
import type { Task } from "@fusion/core";
import type { BoardWorkflowsPayload } from "../../api";
import { getBoardCanDropTaskRejection } from "../boardCanDropTask";

const DEFAULT_WORKFLOW = "builtin:coding";
const CUSTOM_WORKFLOW = "WF-001";

// builtin:coding columns (in-progress counts toward wip; todo does not).
const defaultColumns = [
  { id: "triage", name: "Triage", flags: {} },
  { id: "todo", name: "Todo", flags: {} },
  { id: "in-progress", name: "In Progress", flags: { countsTowardWip: true } },
  { id: "in-review", name: "In Review", flags: {} },
  { id: "done", name: "Done", flags: { complete: true } },
];
const customColumns = [
  { id: "c-intake", name: "Intake", flags: { intake: true } },
  { id: "c-run", name: "Run", flags: { countsTowardWip: true } },
  { id: "c-done", name: "Done", flags: { complete: true } },
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
    size: "M",
    subtasks: [],
    log: [],
    tags: [],
    blockedBy: [],
    source: { sourceType: "api" },
  } as unknown as Task;
}

function boardWorkflows(taskWorkflowIds: Record<string, string> = {}): BoardWorkflowsPayload {
  return {
    flagEnabled: true,
    defaultWorkflowId: DEFAULT_WORKFLOW,
    workflows: [
      { id: DEFAULT_WORKFLOW, name: "Coding", columns: defaultColumns },
      { id: CUSTOM_WORKFLOW, name: "Custom", columns: customColumns },
    ],
    taskWorkflowIds,
  };
}

function canDrop({
  workflows = boardWorkflows(),
  tasks,
  maxConcurrent = 2,
  taskId = "FN-1",
  targetColumnId,
  laneWorkflowId = DEFAULT_WORKFLOW,
}: {
  workflows?: BoardWorkflowsPayload | null | undefined;
  tasks: Task[];
  maxConcurrent?: number;
  taskId?: string;
  targetColumnId: string;
  laneWorkflowId?: string;
}) {
  return getBoardCanDropTaskRejection({
    boardWorkflows: workflows,
    tasks,
    maxConcurrent,
    taskId,
    targetColumnId,
    laneWorkflowId,
  });
}

describe("Board canDropTask pre-check (FN-1416/FN-6029)", () => {
  it("cross-workflow drag returns workflowMismatch", () => {
    const tasks = [makeTask("FN-1", "todo")];

    expect(canDrop({
      workflows: boardWorkflows({ "FN-1": DEFAULT_WORKFLOW }),
      tasks,
      targetColumnId: "c-run",
      laneWorkflowId: CUSTOM_WORKFLOW,
    })).toBe("board.rejection.workflowMismatch");
  });

  it("unknown target column in the source workflow returns unknownColumn", () => {
    const tasks = [makeTask("FN-1", "todo")];

    expect(canDrop({
      workflows: boardWorkflows({ "FN-1": DEFAULT_WORKFLOW }),
      tasks,
      targetColumnId: "does-not-exist",
    })).toBe("board.rejection.unknownColumn");
  });

  it("full wip column returns capacityExhausted", () => {
    // maxConcurrent: 2; two cards already occupy in-progress in the default
    // workflow. Dragging a third from todo into in-progress must reject.
    const tasks = [
      makeTask("FN-1", "todo"),
      makeTask("FN-2", "in-progress"),
      makeTask("FN-3", "in-progress"),
    ];

    expect(canDrop({
      workflows: boardWorkflows({
        "FN-1": DEFAULT_WORKFLOW,
        "FN-2": DEFAULT_WORKFLOW,
        "FN-3": DEFAULT_WORKFLOW,
      }),
      tasks,
      targetColumnId: "in-progress",
    })).toBe("board.rejection.capacityExhausted");
  });

  it("valid same-workflow drops under capacity return null", () => {
    const tasks = [makeTask("FN-1", "todo"), makeTask("FN-2", "in-progress")];
    const workflows = boardWorkflows({ "FN-1": DEFAULT_WORKFLOW, "FN-2": DEFAULT_WORKFLOW });

    expect(canDrop({ workflows, tasks, targetColumnId: "in-progress" })).toBeNull();
    expect(canDrop({ workflows, tasks, targetColumnId: "in-review" })).toBeNull();
  });

  it("returns null when boardWorkflows is undefined", () => {
    expect(canDrop({
      workflows: undefined,
      tasks: [makeTask("FN-1", "todo")],
      targetColumnId: "in-progress",
    })).toBeNull();
  });

  it("returns null when the source task is missing", () => {
    expect(canDrop({
      workflows: boardWorkflows({ "FN-1": DEFAULT_WORKFLOW }),
      tasks: [makeTask("FN-2", "todo")],
      taskId: "FN-1",
      targetColumnId: "in-progress",
    })).toBeNull();
  });

  it("returns null when the source workflow is missing from boardWorkflows", () => {
    expect(canDrop({
      workflows: {
        flagEnabled: true,
        defaultWorkflowId: DEFAULT_WORKFLOW,
        workflows: [{ id: CUSTOM_WORKFLOW, name: "Custom", columns: customColumns }],
        taskWorkflowIds: { "FN-1": DEFAULT_WORKFLOW },
      },
      tasks: [makeTask("FN-1", "todo")],
      targetColumnId: "in-progress",
    })).toBeNull();
  });

  it("falls back to the default workflow when a task has no workflow id", () => {
    expect(canDrop({
      workflows: boardWorkflows({}),
      tasks: [makeTask("FN-1", "todo")],
      targetColumnId: "does-not-exist",
      laneWorkflowId: DEFAULT_WORKFLOW,
    })).toBe("board.rejection.unknownColumn");
  });

  it("allows same-column wip drops even when the column is at capacity", () => {
    const tasks = [
      makeTask("FN-1", "in-progress"),
      makeTask("FN-2", "in-progress"),
      makeTask("FN-3", "in-progress"),
    ];

    expect(canDrop({
      workflows: boardWorkflows({
        "FN-1": DEFAULT_WORKFLOW,
        "FN-2": DEFAULT_WORKFLOW,
        "FN-3": DEFAULT_WORKFLOW,
      }),
      tasks,
      targetColumnId: "in-progress",
    })).toBeNull();
  });

  it("does not count occupants from other workflows toward this workflow's capacity", () => {
    const tasks = [
      makeTask("FN-1", "todo"),
      makeTask("FN-2", "in-progress"),
      makeTask("FN-3", "in-progress"),
      makeTask("FN-4", "in-progress"),
    ];

    expect(canDrop({
      workflows: boardWorkflows({
        "FN-1": DEFAULT_WORKFLOW,
        "FN-2": DEFAULT_WORKFLOW,
        "FN-3": CUSTOM_WORKFLOW,
        "FN-4": CUSTOM_WORKFLOW,
      }),
      tasks,
      targetColumnId: "in-progress",
    })).toBeNull();
  });
});
