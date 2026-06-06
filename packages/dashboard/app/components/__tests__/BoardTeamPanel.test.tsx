import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import * as apiModule from "../../api";
import { BoardTeamPanel } from "../BoardTeamPanel";
import type { BoardColumn, BoardTeamMember, Agent } from "../../api";

vi.mock("../../api", () => ({
  fetchAgents: vi.fn(),
  updateAgentInstructions: vi.fn(),
  retryBoardTeamSeed: vi.fn(),
  addBoardColumn: vi.fn(),
  ApiRequestError: class extends Error {},
}));

const mockFetchAgents = vi.mocked(apiModule.fetchAgents);
const mockUpdateInstructions = vi.mocked(apiModule.updateAgentInstructions);
const mockRetrySeed = vi.mocked(apiModule.retryBoardTeamSeed);

function agent(id: string, name: string, instructions = ""): Agent {
  return {
    id,
    name,
    role: "executor",
    state: "idle",
    createdAt: "",
    updatedAt: "",
    metadata: {},
    instructionsText: instructions,
  } as Agent;
}

const ROLE_COLUMNS: BoardColumn[] = [
  { id: "todo", name: "Todo", flags: {} as never, role: "lead", locked: true },
  { id: "in-progress", name: "In progress", flags: {} as never, role: "executor", locked: true },
  { id: "in-review", name: "In review", flags: {} as never, role: "reviewer", locked: true },
  { id: "deploy", name: "Deploy", flags: {} as never },
];

const STAFFED_TEAM: Record<string, BoardTeamMember> = {
  todo: { agentId: "a-lead", agentName: "Lead (B1)" },
  "in-progress": { agentId: "a-exec", agentName: "Executor (B1)" },
  "in-review": { agentId: "a-rev", agentName: "Reviewer (B1)" },
  deploy: { agentId: "a-deploy", agentName: "Deployer" },
};

const baseProps = {
  boardId: "b1",
  boardName: "Board 1",
  addToast: vi.fn(),
  onClose: vi.fn(),
};

describe("BoardTeamPanel (U12)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchAgents.mockResolvedValue([
      agent("a-lead", "Lead (B1)", "Plan carefully"),
      agent("a-exec", "Executor (B1)"),
      agent("a-rev", "Reviewer (B1)"),
      agent("a-deploy", "Deployer"),
    ]);
  });

  it("shows a loading skeleton until agents resolve, then the roster", async () => {
    render(<BoardTeamPanel {...baseProps} columns={ROLE_COLUMNS} team={STAFFED_TEAM} />);
    expect(screen.getByTestId("board-team-skeleton")).toBeDefined();
    await waitFor(() => expect(screen.getByTestId("board-team-row-todo")).toBeDefined());
  });

  it("renders role badges for the three role columns and a custom badge for custom columns", async () => {
    render(<BoardTeamPanel {...baseProps} columns={ROLE_COLUMNS} team={STAFFED_TEAM} />);
    await waitFor(() => expect(screen.getByTestId("board-team-badge-todo")).toBeDefined());
    expect(screen.getByTestId("board-team-badge-todo").textContent).toBe("Lead");
    expect(screen.getByTestId("board-team-badge-in-progress").textContent).toBe("Executor");
    expect(screen.getByTestId("board-team-badge-in-review").textContent).toBe("Reviewer");
    expect(screen.getByTestId("board-team-badge-deploy").textContent).toBe("Custom");
  });

  it("exposes instructions editing ONLY on role columns (R1) — custom columns get a replace hint, not an editor", async () => {
    render(<BoardTeamPanel {...baseProps} columns={ROLE_COLUMNS} team={STAFFED_TEAM} />);
    await waitFor(() => expect(screen.getByTestId("board-team-row-todo")).toBeDefined());
    // Role column: edit affordance present; no replace hint.
    expect(screen.getByTestId("board-team-instructions-edit-todo")).toBeDefined();
    expect(screen.queryByTestId("board-team-custom-hint-todo")).toBeNull();
    // Custom column: replace hint present; no instructions editor.
    expect(screen.getByTestId("board-team-custom-hint-deploy")).toBeDefined();
    expect(screen.queryByTestId("board-team-instructions-edit-deploy")).toBeNull();
  });

  it("saves edited instructions for a role agent", async () => {
    mockUpdateInstructions.mockResolvedValue(agent("a-lead", "Lead (B1)", "New plan"));
    render(<BoardTeamPanel {...baseProps} columns={ROLE_COLUMNS} team={STAFFED_TEAM} />);
    await waitFor(() => expect(screen.getByTestId("board-team-instructions-edit-todo")).toBeDefined());
    fireEvent.click(screen.getByTestId("board-team-instructions-edit-todo"));
    const input = screen.getByTestId("board-team-instructions-input-todo") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "New plan" } });
    fireEvent.click(screen.getByTestId("board-team-instructions-save-todo"));
    await waitFor(() =>
      expect(mockUpdateInstructions).toHaveBeenCalledWith("a-lead", { instructionsText: "New plan" }, undefined),
    );
  });

  it("renders a seed-failed state with a retry CTA when role columns are unstaffed", async () => {
    mockRetrySeed.mockResolvedValue({ board: {} as never, seeded: true, team: { todo: "x" } });
    render(<BoardTeamPanel {...baseProps} columns={ROLE_COLUMNS} team={{}} />);
    await waitFor(() => expect(screen.getByTestId("board-team-seed-failed")).toBeDefined());
    fireEvent.click(screen.getByTestId("board-team-seed-retry"));
    await waitFor(() => expect(mockRetrySeed).toHaveBeenCalledWith("b1", undefined));
  });
});
