import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { WorkflowFieldDefinition } from "../../api";
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

function renderModal(task = makeTask({ column: "done" })) {
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

describe("TaskDetailModal custom fields (U13/KTD-14)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders no fields section when the board's workflow declares no fields (today's UI)", async () => {
    vi.spyOn(dashboardApi, "fetchBoardWorkflows").mockResolvedValue({
      boards: [
        { id: "b1", name: "Board 1", description: "", requirePlanApproval: false, lfgMode: false, ordering: 0 },
      ],
      boardPayloads: { b1: { columns: [], team: {}, taskIds: [] } },
      defaultBoardId: "b1",
    });
    renderModal();
    // Allow the field-defs fetch to settle.
    await waitFor(() => expect(dashboardApi.fetchBoardWorkflows).toHaveBeenCalled());
    expect(screen.queryByTestId("task-fields-section")).toBeNull();
  });

  it("renders the schema-driven fields section when the board's workflow declares fields", async () => {
    vi.spyOn(dashboardApi, "fetchBoardWorkflows").mockResolvedValue({
      boards: [
        { id: "b1", name: "Board 1", description: "", requirePlanApproval: false, lfgMode: false, ordering: 0 },
      ],
      boardPayloads: {
        b1: {
          columns: [],
          team: {},
          taskIds: ["FN-001"],
          fields: [
            { id: "owner", name: "Owner", type: "string", render: { placement: "detail" } },
          ],
        },
      },
      defaultBoardId: "b1",
    });
    renderModal(makeTask({ id: "FN-001", column: "done", customFields: { owner: "alice" } }));
    await waitFor(() => expect(screen.getByTestId("task-fields-section")).toBeTruthy());
    expect((screen.getByLabelText("Owner") as HTMLInputElement).value).toBe("alice");
  });

  it("uses workflowFieldDefs prop directly, ignoring the fetched payload's fields", async () => {
    // The modal still fetches the payload once (the boards index feeds the
    // cross-board move control), but with the prop provided the field defs must
    // come from the prop — NOT from the payload (which here carries none).
    const fetchSpy = vi.spyOn(dashboardApi, "fetchBoardWorkflows").mockResolvedValue({
      boards: [],
      boardPayloads: {},
      defaultBoardId: null,
    });
    const defs: WorkflowFieldDefinition[] = [
      { id: "owner", name: "Owner", type: "string", render: { placement: "detail" } },
    ];
    render(
      <FileBrowserProvider openFile={vi.fn()}>
        <TaskDetailModal
          task={makeTask({ id: "FN-002", column: "done", customFields: { owner: "bob" } })}
          workflowFieldDefs={defs}
          onClose={noop}
          onMoveTask={noopMove}
          onDeleteTask={noopDelete}
          onMergeTask={noopMerge}
          onOpenDetail={noopOpenDetail}
          addToast={noop}
        />
      </FileBrowserProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("task-fields-section")).toBeTruthy());
    expect((screen.getByLabelText("Owner") as HTMLInputElement).value).toBe("bob");
    // The payload fetch (boards index) may fire, but the rendered defs above
    // came from the prop — the fetched payload carries no fields.
    void fetchSpy;
  });

  it("renders no fields section when workflowFieldDefs prop is an empty array", async () => {
    const fetchSpy = vi.spyOn(dashboardApi, "fetchBoardWorkflows").mockResolvedValue({
      boards: [],
      boardPayloads: {},
      defaultBoardId: null,
    });
    render(
      <FileBrowserProvider openFile={vi.fn()}>
        <TaskDetailModal
          task={makeTask({ id: "FN-003", column: "done" })}
          workflowFieldDefs={[]}
          onClose={noop}
          onMoveTask={noopMove}
          onDeleteTask={noopDelete}
          onMergeTask={noopMerge}
          onOpenDetail={noopOpenDetail}
          addToast={noop}
        />
      </FileBrowserProvider>,
    );
    // Give React a tick to settle; no section should appear.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId("task-fields-section")).toBeNull();
    void fetchSpy;
  });
});
