import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import {
  makeTask,
  noop,
  noopDelete,
  noopMerge,
  noopMove,
  noopOpenDetail,
  setupTaskDetailModalHooks,
} from "./TaskDetailModal.test-helpers";
import { TaskDetailModal } from "../TaskDetailModal";
import * as dashboardApi from "../../api";
import { FileBrowserProvider } from "../../context/FileBrowserContext";

setupTaskDetailModalHooks();

// A company-model board whose Lead column (todo) is staffed, so feedback can be
// addressed to the Lead.
function mockBoardWithLead(taskId: string) {
  vi.spyOn(dashboardApi, "fetchBoardWorkflows").mockResolvedValue({
    boards: [{ id: "b1", name: "Board 1", description: "", requirePlanApproval: true, lfgMode: false, ordering: 0 }],
    boardPayloads: {
      b1: {
        columns: [
          { id: "todo", name: "Todo", flags: {} as never, role: "lead", locked: true },
          { id: "in-progress", name: "In progress", flags: {} as never, role: "executor", locked: true },
          { id: "in-review", name: "In review", flags: {} as never, role: "reviewer", locked: true },
        ],
        team: { todo: { agentId: "a-lead", agentName: "Lead (B1)" } },
        taskIds: [taskId],
      },
    },
    defaultBoardId: "b1",
  });
}

function renderModal(task: ReturnType<typeof makeTask>) {
  return render(
    <FileBrowserProvider openFile={vi.fn()}>
      <TaskDetailModal
        task={task}
        onClose={noop}
        onMoveTask={noopMove}
        onDeleteTask={noopDelete}
        onMergeTask={noopMerge}
        onOpenDetail={noopOpenDetail}
        addToast={noop}
      />
    </FileBrowserProvider>,
  );
}

describe("TaskDetailModal plan-approval surface (U12 R20)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The plan artifact (PROMPT.md) comes through the full detail's `prompt`.
    vi.spyOn(dashboardApi, "fetchTaskDetail").mockResolvedValue(
      makeTask({ id: "FN-700", column: "todo", status: "awaiting-approval", prompt: "## Plan\nDo the thing" }),
    );
  });

  it("shows Approve + Send-feedback actions for a company-model task parked in the Lead column (todo)", async () => {
    mockBoardWithLead("FN-700");
    const task = makeTask({ id: "FN-700", column: "todo", status: "awaiting-approval", prompt: "## Plan" });
    renderModal(task);
    await waitFor(() => expect(screen.getByTestId("plan-approve")).toBeDefined());
    expect(screen.getByTestId("plan-send-feedback")).toBeDefined();
  });

  it("Approve calls the approve-plan route", async () => {
    mockBoardWithLead("FN-700");
    const approveSpy = vi.spyOn(dashboardApi, "approvePlan").mockResolvedValue(makeTask());
    const task = makeTask({ id: "FN-700", column: "todo", status: "awaiting-approval", prompt: "## Plan" });
    renderModal(task);
    await waitFor(() => expect(screen.getByTestId("plan-approve")).toBeDefined());
    fireEvent.click(screen.getByTestId("plan-approve"));
    await waitFor(() => expect(approveSpy).toHaveBeenCalledWith("FN-700", undefined));
  });

  it("Send feedback reveals an inline textarea and addresses the Lead via the per-task agent-message channel", async () => {
    mockBoardWithLead("FN-700");
    const sendSpy = vi
      .spyOn(dashboardApi, "sendTaskAgentMessage")
      .mockResolvedValue({ task: makeTask(), messageId: "m1" });
    // window.prompt must NOT be used — it's blocked in embedded WebViews (Electron).
    const promptSpy = vi.spyOn(window, "prompt");
    const task = makeTask({ id: "FN-700", column: "todo", status: "awaiting-approval", prompt: "## Plan" });
    renderModal(task);
    await waitFor(() => expect(screen.getByTestId("plan-send-feedback")).toBeDefined());
    // Let the board payload (and leadAgentId) settle.
    await waitFor(() => expect(dashboardApi.fetchBoardWorkflows).toHaveBeenCalled());

    // The inline disclosure is hidden until "Send feedback" is clicked.
    expect(screen.queryByTestId("plan-feedback-disclosure")).toBeNull();
    fireEvent.click(screen.getByTestId("plan-send-feedback"));

    const textarea = await screen.findByTestId("plan-feedback-textarea");
    fireEvent.change(textarea, { target: { value: "tighten the scope" } });
    fireEvent.click(screen.getByTestId("plan-feedback-submit"));

    await waitFor(() =>
      expect(sendSpy).toHaveBeenCalledWith("FN-700", "a-lead", "tighten the scope", undefined),
    );
    expect(promptSpy).not.toHaveBeenCalled();
    promptSpy.mockRestore();
  });

  it("Send feedback submit is disabled until non-empty feedback is entered", async () => {
    mockBoardWithLead("FN-700");
    const task = makeTask({ id: "FN-700", column: "todo", status: "awaiting-approval", prompt: "## Plan" });
    renderModal(task);
    await waitFor(() => expect(screen.getByTestId("plan-send-feedback")).toBeDefined());
    fireEvent.click(screen.getByTestId("plan-send-feedback"));
    const submit = await screen.findByTestId("plan-feedback-submit");
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId("plan-feedback-textarea"), { target: { value: "do better" } });
    expect((submit as HTMLButtonElement).disabled).toBe(false);
  });
});
