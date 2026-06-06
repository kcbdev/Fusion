import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import * as apiModule from "../../api";
import {
  BoardCreateModal,
  DEFAULT_BOARD_TYPES,
  COMPOUND_ENGINEERING_BOARD_TYPE_ID,
} from "../BoardCreateModal";

vi.mock("../../api", () => ({
  createBoard: vi.fn(),
}));

const mockCreateBoard = vi.mocked(apiModule.createBoard);

const baseProps = {
  isOpen: true,
  onClose: vi.fn(),
  onCreated: vi.fn(),
  addToast: vi.fn(),
};

describe("BoardCreateModal (U12)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not render when closed", () => {
    const { container } = render(<BoardCreateModal {...baseProps} isOpen={false} />);
    expect(container.querySelector('[data-testid="board-create-modal"]')).toBeNull();
  });

  it("renders the standard board type from the registry", () => {
    render(<BoardCreateModal {...baseProps} />);
    expect(screen.getByTestId("board-create-type-standard")).toBeDefined();
  });

  it("requires a name before submitting", async () => {
    render(<BoardCreateModal {...baseProps} />);
    fireEvent.click(screen.getByTestId("board-create-submit"));
    await waitFor(() => expect(screen.getByTestId("board-create-error")).toBeDefined());
    expect(mockCreateBoard).not.toHaveBeenCalled();
  });

  it("creates a board, calls onCreated with it, and closes", async () => {
    const board = { id: "b9", name: "Docs", description: "", requirePlanApproval: false, lfgMode: false, ordering: 1 };
    mockCreateBoard.mockResolvedValue({ board, seeded: true });
    const onCreated = vi.fn();
    const onClose = vi.fn();
    render(<BoardCreateModal {...baseProps} onCreated={onCreated} onClose={onClose} />);

    fireEvent.change(screen.getByTestId("board-create-name"), { target: { value: "Docs" } });
    fireEvent.change(screen.getByTestId("board-create-description"), { target: { value: "Documentation" } });
    fireEvent.click(screen.getByTestId("board-create-submit"));

    await waitFor(() => expect(mockCreateBoard).toHaveBeenCalled());
    expect(mockCreateBoard).toHaveBeenCalledWith(
      { name: "Docs", description: "Documentation", boardType: "standard" },
      undefined,
    );
    expect(onCreated).toHaveBeenCalledWith(board);
    expect(onClose).toHaveBeenCalled();
  });

  it("renders extensibly from an injected board-type registry", () => {
    render(
      <BoardCreateModal
        {...baseProps}
        boardTypes={[
          {
            id: "standard",
            labelKey: "x",
            labelDefault: "Standard",
            descriptionKey: "y",
            descriptionDefault: "d",
            available: true,
          },
          {
            id: "ce",
            labelKey: "x",
            labelDefault: "Compound Engineering",
            descriptionKey: "y",
            descriptionDefault: "d",
            available: true,
          },
        ]}
      />,
    );
    expect(screen.getByTestId("board-create-type-standard")).toBeDefined();
    expect(screen.getByTestId("board-create-type-ce")).toBeDefined();
  });

  it("hides the Compound Engineering type by default (plugin not installed) (U13)", () => {
    // The default registry ships CE present but available:false; the modal only
    // renders available types, so CE is absent until the caller flips it on.
    render(<BoardCreateModal {...baseProps} boardTypes={DEFAULT_BOARD_TYPES} />);
    expect(screen.getByTestId("board-create-type-standard")).toBeDefined();
    expect(
      screen.queryByTestId(`board-create-type-${COMPOUND_ENGINEERING_BOARD_TYPE_ID}`),
    ).toBeNull();
  });

  it("renders the Compound Engineering type when made available, never as the default (U13)", () => {
    const types = DEFAULT_BOARD_TYPES.map((t) => ({ ...t, available: true }));
    render(<BoardCreateModal {...baseProps} boardTypes={types} />);
    // Standard is first/default; CE is present but not pre-selected.
    expect(screen.getByTestId("board-create-type-standard")).toBeDefined();
    const ce = screen.getByTestId(
      `board-create-type-${COMPOUND_ENGINEERING_BOARD_TYPE_ID}`,
    );
    expect(ce).toBeDefined();
    const standardRadio = screen
      .getByTestId("board-create-type-standard")
      .querySelector("input") as HTMLInputElement;
    expect(standardRadio.checked).toBe(true);
    // The LFG toggle is hidden until a LFG-supporting type is selected.
    expect(screen.queryByTestId("board-create-lfg")).toBeNull();
  });

  it("reveals the LFG toggle for the CE type and passes lfgMode on submit (U13, R22)", async () => {
    const board = { id: "ce1", name: "CE", description: "", requirePlanApproval: true, lfgMode: true, ordering: 2 };
    mockCreateBoard.mockResolvedValue({ board, seeded: true });
    const types = DEFAULT_BOARD_TYPES.map((t) => ({ ...t, available: true }));
    render(<BoardCreateModal {...baseProps} boardTypes={types} />);

    // Select the CE type → LFG toggle appears.
    fireEvent.click(
      screen
        .getByTestId(`board-create-type-${COMPOUND_ENGINEERING_BOARD_TYPE_ID}`)
        .querySelector("input") as HTMLInputElement,
    );
    const lfg = screen.getByTestId("board-create-lfg-toggle") as HTMLInputElement;
    fireEvent.click(lfg);

    fireEvent.change(screen.getByTestId("board-create-name"), { target: { value: "CE" } });
    fireEvent.click(screen.getByTestId("board-create-submit"));

    await waitFor(() => expect(mockCreateBoard).toHaveBeenCalled());
    expect(mockCreateBoard).toHaveBeenCalledWith(
      {
        name: "CE",
        description: "",
        boardType: COMPOUND_ENGINEERING_BOARD_TYPE_ID,
        lfgMode: true,
      },
      undefined,
    );
  });
});
