import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  makeTask,
  noop,
  noopDelete,
  noopMerge,
  noopMove,
  noopOpenDetail,
  setupTaskDetailModalHooks,
  mockConfirmWithChoice,
} from "./TaskDetailModal.test-helpers";
import { TaskDetailModal } from "../TaskDetailModal";

vi.mock("../BranchGroupCard", () => ({
  BranchGroupCard: ({ groupId }: { groupId: string }) => <div>Mock Branch Group {groupId}</div>,
}));

setupTaskDetailModalHooks();

describe("TaskDetailModal GitHub tracking CTA", () => {
  it("disables create tracking issue when task has no usable title", async () => {
    const user = userEvent.setup();
    render(
      <TaskDetailModal
        task={makeTask({
          githubTracking: { enabled: true },
          title: "",
          description: "",
        })}
        onClose={noop}
        onMoveTask={noopMove}
        onDeleteTask={noopDelete}
        onMergeTask={noopMerge}
        onOpenDetail={noopOpenDetail}
        addToast={noop}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Expand GitHub tracking details" }));
    const button = screen.getByRole("button", { name: "Create tracking issue" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "Add a title or description so a tracking issue can be created.");
    expect(screen.getByText("Tracking issue will be created once this task has a title or description to summarize.")).toBeInTheDocument();
  });

  it("enables create tracking issue when task title is present", async () => {
    const user = userEvent.setup();
    render(
      <TaskDetailModal
        task={makeTask({
          githubTracking: { enabled: true },
          title: "Real title",
          description: "",
        })}
        onClose={noop}
        onMoveTask={noopMove}
        onDeleteTask={noopDelete}
        onMergeTask={noopMerge}
        onOpenDetail={noopOpenDetail}
        addToast={noop}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Expand GitHub tracking details" }));
    expect(screen.getByRole("button", { name: "Create tracking issue" })).toBeEnabled();
    expect(screen.queryByText("Tracking issue will be created once this task has a title or description to summarize.")).not.toBeInTheDocument();
  });

  it("enables create tracking issue when task description has a non-empty first line", async () => {
    const user = userEvent.setup();
    render(
      <TaskDetailModal
        task={makeTask({
          githubTracking: { enabled: true },
          title: "",
          description: "A meaningful first line.\nMore text.",
        })}
        onClose={noop}
        onMoveTask={noopMove}
        onDeleteTask={noopDelete}
        onMergeTask={noopMerge}
        onOpenDetail={noopOpenDetail}
        addToast={noop}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Expand GitHub tracking details" }));
    expect(screen.getByRole("button", { name: "Create tracking issue" })).toBeEnabled();
    expect(screen.queryByText("Tracking issue will be created once this task has a title or description to summarize.")).not.toBeInTheDocument();
  });
});

describe("TaskDetailModal branch group surfacing", () => {
  it("renders branch group card when task has group context", () => {
    render(
      <TaskDetailModal
        task={makeTask({ branchContext: { groupId: "BG-1", source: "planning", assignmentMode: "shared" } })}
        onClose={noop}
        onMoveTask={noopMove}
        onDeleteTask={noopDelete}
        onMergeTask={noopMerge}
        onOpenDetail={noopOpenDetail}
        addToast={noop}
      />,
    );

    expect(screen.getByText("Mock Branch Group BG-1")).toBeInTheDocument();
  });
});

describe("TaskDetailModal delete affordance", () => {
  it("archives done task when Archive Instead is chosen", async () => {
    const user = userEvent.setup();
    const onArchiveTask = vi.fn(async () => makeTask({ column: "archived" }));
    const onDeleteTask = vi.fn(async () => makeTask());
    const onClose = vi.fn();
    mockConfirmWithChoice.mockResolvedValueOnce("tertiary");

    render(
      <TaskDetailModal
        task={makeTask({ column: "done" })}
        onClose={onClose}
        onMoveTask={noopMove}
        onDeleteTask={onDeleteTask}
        onArchiveTask={onArchiveTask}
        onMergeTask={noopMerge}
        onOpenDetail={noopOpenDetail}
        addToast={noop}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));

    await waitFor(() => {
      expect(mockConfirmWithChoice).toHaveBeenCalledWith(expect.objectContaining({ tertiaryLabel: "Archive Instead" }));
      expect(onArchiveTask).toHaveBeenCalledWith("FN-099");
      expect(onDeleteTask).not.toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });
});

describe("TaskDetailModal in-review stall diagnostics", () => {
  it("renders diagnostic row and jumps to highlighted activity entry", async () => {
    const user = userEvent.setup();
    render(
      <TaskDetailModal
        task={makeTask({
          column: "in-review",
          inReviewStall: {
            code: "merge-blocker",
            reason: "Workflow pre-merge check failed",
            observedAt: "2026-05-13T00:00:00.000Z",
          },
          log: [
            { timestamp: "2026-05-13T00:01:00.000Z", action: "In-review stall surfaced [merge-blocker]: Workflow pre-merge check failed" },
          ],
        })}
        onClose={noop}
        onMoveTask={noopMove}
        onDeleteTask={noopDelete}
        onMergeTask={noopMerge}
        onOpenDetail={noopOpenDetail}
        addToast={noop}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Pull Request" }));

    expect(screen.getByText("Merge blocked by a pre-merge check")).toBeInTheDocument();
    expect(screen.getByText("Workflow pre-merge check failed")).toBeInTheDocument();
    expect(screen.getByText("Open the Review tab to see which step is blocking, then fix the failure or override the step.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "View activity log" }));
    expect(screen.getByRole("button", { name: "Logs" })).toHaveClass("detail-tab-active");
    expect(screen.getByRole("button", { name: "Activity" })).toHaveClass("log-subview-btn-active");
    const highlighted = document.querySelector(".detail-log-entry--stall-highlight .detail-log-action");
    expect(highlighted?.textContent).toContain("In-review stall surfaced [merge-blocker]");
  });

  it("renders retry-exhausted badge label with counter", async () => {
    const user = userEvent.setup();
    render(
      <TaskDetailModal
        task={makeTask({
          column: "in-review",
          mergeRetries: 3,
          inReviewStall: {
            code: "merge-retries-exhausted",
            reason: "Auto-merge retries exhausted",
            observedAt: "2026-05-13T00:00:00.000Z",
          },
        })}
        onClose={noop}
        onMoveTask={noopMove}
        onDeleteTask={noopDelete}
        onMergeTask={noopMerge}
        onOpenDetail={noopOpenDetail}
        addToast={noop}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Pull Request" }));
    expect(screen.getByText("Retries exhausted 3/3")).toBeInTheDocument();
  });

  it("shows no-log copy when no matching stall entry exists", async () => {
    const user = userEvent.setup();
    render(
      <TaskDetailModal
        task={makeTask({
          column: "in-review",
          inReviewStall: {
            code: "merge-blocker",
            reason: "Workflow pre-merge check failed",
            observedAt: "2026-05-13T00:00:00.000Z",
          },
          log: [{ timestamp: "2026-05-13T00:01:00.000Z", action: "Something else" }],
        })}
        onClose={noop}
        onMoveTask={noopMove}
        onDeleteTask={noopDelete}
        onMergeTask={noopMerge}
        onOpenDetail={noopOpenDetail}
        addToast={noop}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Pull Request" }));
    expect(screen.getByText("No log entry yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "View activity log" })).not.toBeInTheDocument();
  });

  it("FN-4570: hides merge-blocker diagnostic while task is actively merging", () => {
    render(
      <TaskDetailModal
        task={makeTask({
          column: "in-review",
          status: "merging-fix",
          inReviewStall: {
            code: "merge-blocker",
            reason: "Workflow pre-merge check failed",
            observedAt: "2026-05-13T00:00:00.000Z",
          },
        })}
        onClose={noop}
        onMoveTask={noopMove}
        onDeleteTask={noopDelete}
        onMergeTask={noopMerge}
        onOpenDetail={noopOpenDetail}
        addToast={noop}
      />,
    );

    expect(screen.queryByText("Merge blocked by a pre-merge check")).not.toBeInTheDocument();
  });

  it.each([
    {
      label: "paused in-review task",
      task: makeTask({
        column: "in-review",
        paused: true,
        inReviewStall: {
          code: "merge-blocker",
          reason: "Workflow pre-merge check failed",
          observedAt: "2026-05-13T00:00:00.000Z",
        },
      }),
    },
    {
      label: "non in-review task",
      task: makeTask({
        column: "in-progress",
        inReviewStall: {
          code: "merge-blocker",
          reason: "Workflow pre-merge check failed",
          observedAt: "2026-05-13T00:00:00.000Z",
        },
      }),
    },
  ])("does not render diagnostic row for $label", ({ task }) => {
    render(
      <TaskDetailModal
        task={task}
        onClose={noop}
        onMoveTask={noopMove}
        onDeleteTask={noopDelete}
        onMergeTask={noopMerge}
        onOpenDetail={noopOpenDetail}
        addToast={noop}
      />,
    );

    expect(screen.queryByText("Merge blocked by a pre-merge check")).not.toBeInTheDocument();
  });
});
