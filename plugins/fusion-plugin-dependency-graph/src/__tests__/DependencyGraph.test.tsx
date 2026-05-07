import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Task } from "@fusion/core";
import { DependencyGraph } from "../DependencyGraph";

const fitToGraph = vi.fn();

vi.mock("@fusion/dashboard/app/components/TaskCard", () => ({
  TaskCard: ({ task, onOpenDetail, disableDrag }: { task: Task; onOpenDetail: (task: Task) => void; disableDrag?: boolean }) => (
    <button data-testid={`task-${task.id}`} draggable={!disableDrag} onClick={() => onOpenDetail(task)}>{task.id}</button>
  ),
}));

vi.mock("../useGraphInteraction", () => ({
  useGraphInteraction: () => ({
    transform: "translate(0px, 0px) scale(1)",
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    fitToGraph,
    onPointerDown: vi.fn(),
    onPointerMove: vi.fn(),
    onPointerUp: vi.fn(),
    onWheelZoom: vi.fn(),
  }),
}));

function createTask(id: string, column: Task["column"], dependencies: string[] = []): Task {
  return { id, description: id, column, dependencies, steps: [], currentStep: 0, log: [] } as Task;
}

describe("DependencyGraph", () => {
  beforeEach(() => {
    fitToGraph.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders empty state for empty list", () => {
    render(<DependencyGraph tasks={[]} onOpenTaskDetail={vi.fn()} />);
    expect(screen.getByText(/No active tasks/i)).toBeTruthy();
  });

  it("renders only triage/todo/in-progress/in-review nodes from mixed columns", () => {
    render(
      <DependencyGraph
        tasks={[
          createTask("A", "triage"),
          createTask("B", "todo"),
          createTask("C", "in-progress"),
          createTask("D", "in-review"),
          createTask("E", "done"),
          createTask("F", "archived"),
        ]}
        onOpenTaskDetail={vi.fn()}
      />,
    );

    expect(screen.getByTestId("graph-task-node-A")).toBeTruthy();
    expect(screen.getByTestId("graph-task-node-B")).toBeTruthy();
    expect(screen.getByTestId("graph-task-node-C")).toBeTruthy();
    expect(screen.getByTestId("graph-task-node-D")).toBeTruthy();
    expect(screen.queryByTestId("graph-task-node-E")).toBeNull();
    expect(screen.queryByTestId("graph-task-node-F")).toBeNull();
  });

  it("renders zero nodes and edges when only done tasks are provided", () => {
    const { container } = render(<DependencyGraph tasks={[createTask("A", "done", ["B"]), createTask("B", "done")]} onOpenTaskDetail={vi.fn()} />);

    expect(container.querySelectorAll("[data-testid^='graph-task-node-']")).toHaveLength(0);
    expect(screen.queryAllByTestId("dependency-edge")).toHaveLength(0);
  });

  it("renders zero nodes and edges when only archived tasks are provided", () => {
    const { container } = render(
      <DependencyGraph tasks={[createTask("A", "archived", ["B"]), createTask("B", "archived")]} onOpenTaskDetail={vi.fn()} />,
    );

    expect(container.querySelectorAll("[data-testid^='graph-task-node-']")).toHaveLength(0);
    expect(screen.queryAllByTestId("dependency-edge")).toHaveLength(0);
  });

  it("drops edge from in-review task to done dependency while keeping node", () => {
    const { container } = render(<DependencyGraph tasks={[createTask("A", "in-review", ["B"]), createTask("B", "done")]} onOpenTaskDetail={vi.fn()} />);

    expect(screen.getByTestId("graph-task-node-A")).toBeTruthy();
    expect(screen.queryByTestId("graph-task-node-B")).toBeNull();
    expect(screen.queryAllByTestId("dependency-edge")).toHaveLength(0);
    expect(container.querySelector(".graph-task-node--in-review")).toBeTruthy();
  });

  it("renders edge between in-progress task and in-review dependency", () => {
    render(<DependencyGraph tasks={[createTask("A", "in-progress", ["B"]), createTask("B", "in-review")]} onOpenTaskDetail={vi.fn()} />);

    expect(screen.getByTestId("graph-task-node-A")).toBeTruthy();
    expect(screen.getByTestId("graph-task-node-B")).toBeTruthy();
    expect(screen.getAllByTestId("dependency-edge")).toHaveLength(1);
    expect(screen.getByTestId("graph-task-node-B").className).toContain("graph-task-node--in-review");
  });

  it("renders embedded cards with native dragging disabled", () => {
    render(<DependencyGraph tasks={[createTask("A", "in-progress")]} onOpenTaskDetail={vi.fn()} />);
    expect(screen.getByTestId("task-A").getAttribute("draggable")).toBe("false");
  });

  it("clicking a card triggers onOpenDetail", () => {
    const onOpenDetail = vi.fn();
    render(<DependencyGraph tasks={[createTask("A", "in-progress")]} onOpenDetail={onOpenDetail} />);
    fireEvent.click(screen.getByTestId("task-A"));
    expect(onOpenDetail).toHaveBeenCalledWith(expect.objectContaining({ id: "A" }));
  });

  it("fit-to-screen button triggers fitToGraph", () => {
    render(<DependencyGraph tasks={[createTask("A", "todo")]} onOpenTaskDetail={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Fit to screen" }));
    expect(fitToGraph).toHaveBeenCalled();
  });
});
