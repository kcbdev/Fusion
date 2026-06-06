import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Task } from "@fusion/core";
import type { BoardSummary } from "../../api";
import { MoveToBoardControl } from "../MoveToBoardControl";

const moveTaskToBoardMock = vi.fn();
vi.mock("../../api", () => ({
  moveTaskToBoard: (...args: unknown[]) => moveTaskToBoardMock(...args),
}));

const confirmMock = vi.fn();
vi.mock("../../hooks/useConfirm", () => ({
  useConfirm: () => ({ confirm: confirmMock }),
}));

function mkTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "FN-1",
    title: "T",
    description: "d",
    column: "todo",
    dependencies: [],
    steps: [],
    currentStep: 0,
    log: [],
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    boardId: "board-a",
    ...overrides,
  } as Task;
}

const TWO_BOARDS: BoardSummary[] = [
  { id: "board-a", name: "Alpha", description: "", requirePlanApproval: false, lfgMode: false, ordering: 0 },
  { id: "board-b", name: "Beta", description: "", requirePlanApproval: false, lfgMode: false, ordering: 1 },
];

function renderControl(task: Task, extra: Partial<React.ComponentProps<typeof MoveToBoardControl>> = {}) {
  return render(
    <MoveToBoardControl
      task={task}
      boards={TWO_BOARDS}
      defaultBoardId="board-a"
      addToast={() => {}}
      {...extra}
    />,
  );
}

beforeEach(() => {
  moveTaskToBoardMock.mockReset();
  moveTaskToBoardMock.mockResolvedValue(mkTask({ boardId: "board-b", column: "todo" }));
  confirmMock.mockReset();
});

describe("MoveToBoardControl (U10, R13)", () => {
  it("lists boards other than the current home", async () => {
    renderControl(mkTask());
    await waitFor(() => expect(screen.getByTestId("move-to-board-select")).toBeDefined());
    const options = Array.from(screen.getByTestId("move-to-board-select").querySelectorAll("option"))
      .map((o) => (o as HTMLOptionElement).value)
      .filter(Boolean);
    expect(options).toEqual(["board-b"]);
  });

  it("hides itself when there is only one board", async () => {
    const { container } = render(
      <MoveToBoardControl
        task={mkTask()}
        boards={[TWO_BOARDS[0]]}
        defaultBoardId="board-a"
        addToast={() => {}}
      />,
    );
    await waitFor(() => expect(container.querySelector('[data-testid="move-to-board"]')).toBeNull());
  });

  it("for a fresh task (no active work) moves without a confirm dialog", async () => {
    const onMoved = vi.fn();
    renderControl(mkTask({ status: "ready" }), { onMoved });
    await waitFor(() => expect(screen.getByTestId("move-to-board-select")).toBeDefined());
    fireEvent.change(screen.getByTestId("move-to-board-select"), { target: { value: "board-b" } });
    await waitFor(() => expect(moveTaskToBoardMock).toHaveBeenCalledWith("FN-1", "board-b", undefined));
    expect(confirmMock).not.toHaveBeenCalled();
    expect(onMoved).toHaveBeenCalled();
  });

  it("for a task with an active session, warns then moves on confirm", async () => {
    confirmMock.mockResolvedValue(true);
    const onMoved = vi.fn();
    renderControl(mkTask({ status: "executing" }), { onMoved });
    await waitFor(() => expect(screen.getByTestId("move-to-board-select")).toBeDefined());
    fireEvent.change(screen.getByTestId("move-to-board-select"), { target: { value: "board-b" } });
    await waitFor(() => expect(confirmMock).toHaveBeenCalled());
    const args = confirmMock.mock.calls[0][0];
    expect(args.danger).toBe(true);
    await waitFor(() => expect(moveTaskToBoardMock).toHaveBeenCalledWith("FN-1", "board-b", undefined));
    expect(onMoved).toHaveBeenCalled();
  });

  it("aborts the move when the warning is dismissed", async () => {
    confirmMock.mockResolvedValue(false);
    renderControl(mkTask({ status: "executing" }));
    await waitFor(() => expect(screen.getByTestId("move-to-board-select")).toBeDefined());
    fireEvent.change(screen.getByTestId("move-to-board-select"), { target: { value: "board-b" } });
    await waitFor(() => expect(confirmMock).toHaveBeenCalled());
    expect(moveTaskToBoardMock).not.toHaveBeenCalled();
  });

  it("surfaces an inline error when the move fails", async () => {
    confirmMock.mockResolvedValue(true);
    moveTaskToBoardMock.mockRejectedValue(new Error("boom"));
    const addToast = vi.fn();
    renderControl(mkTask({ status: "executing" }), { addToast });
    await waitFor(() => expect(screen.getByTestId("move-to-board-select")).toBeDefined());
    fireEvent.change(screen.getByTestId("move-to-board-select"), { target: { value: "board-b" } });
    await waitFor(() => expect(screen.getByTestId("move-to-board-error")).toBeDefined());
    expect(addToast).toHaveBeenCalled();
  });
});
