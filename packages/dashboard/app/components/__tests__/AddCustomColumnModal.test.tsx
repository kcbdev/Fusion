import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import * as apiModule from "../../api";
import { AddCustomColumnModal } from "../AddCustomColumnModal";

vi.mock("../../api", () => {
  class FakeApiRequestError extends Error {
    status: number;
    details?: Record<string, unknown>;
    constructor(message: string, status: number, details?: Record<string, unknown>) {
      super(message);
      this.status = status;
      this.details = details;
    }
  }
  return {
    addBoardColumn: vi.fn(),
    fetchAgents: vi.fn(),
    ApiRequestError: FakeApiRequestError,
  };
});

const mockAdd = vi.mocked(apiModule.addBoardColumn);
const mockFetchAgents = vi.mocked(apiModule.fetchAgents);
const FakeApiRequestError = apiModule.ApiRequestError as unknown as new (
  message: string,
  status: number,
  details?: Record<string, unknown>,
) => Error;

const baseProps = {
  isOpen: true,
  onClose: vi.fn(),
  boardId: "b1",
  addToast: vi.fn(),
};

describe("AddCustomColumnModal (U12)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchAgents.mockResolvedValue([]);
  });

  it("offers the two legal placements (between in-progress/in-review, and after in-review)", () => {
    render(<AddCustomColumnModal {...baseProps} />);
    expect(screen.getByTestId("add-column-placement-before-review")).toBeDefined();
    expect(screen.getByTestId("add-column-placement-after-review")).toBeDefined();
  });

  it("submits name + placement + a new agent", async () => {
    mockAdd.mockResolvedValue({ boardId: "b1", columnId: "deploy", workflowId: "wf", agentId: "a1" });
    const onColumnAdded = vi.fn();
    render(<AddCustomColumnModal {...baseProps} onColumnAdded={onColumnAdded} />);

    fireEvent.change(screen.getByTestId("add-column-name"), { target: { value: "Deploy" } });
    fireEvent.click(screen.getByTestId("add-column-placement-after-review").querySelector("input")!);
    fireEvent.change(screen.getByTestId("add-column-new-agent-name"), { target: { value: "Deployer" } });
    fireEvent.click(screen.getByTestId("add-column-submit"));

    await waitFor(() => expect(mockAdd).toHaveBeenCalled());
    expect(mockAdd).toHaveBeenCalledWith(
      "b1",
      { name: "Deploy", placement: "after-review", agent: { create: { name: "Deployer" } } },
      undefined,
    );
    expect(onColumnAdded).toHaveBeenCalled();
  });

  it("surfaces the AE3 already-staffed rejection inline", async () => {
    mockAdd.mockRejectedValue(
      new FakeApiRequestError("already staffed", 400, { reason: "agent-multiple-columns" }),
    );
    render(<AddCustomColumnModal {...baseProps} />);
    fireEvent.change(screen.getByTestId("add-column-name"), { target: { value: "Deploy" } });
    fireEvent.change(screen.getByTestId("add-column-new-agent-name"), { target: { value: "Dup" } });
    fireEvent.click(screen.getByTestId("add-column-submit"));

    await waitFor(() => expect(screen.getByTestId("add-column-error")).toBeDefined());
    expect(screen.getByTestId("add-column-error").textContent).toMatch(/already staffs/i);
  });
});
