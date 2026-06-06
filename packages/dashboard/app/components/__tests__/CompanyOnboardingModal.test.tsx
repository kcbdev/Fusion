import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import * as apiModule from "../../api";
import { CompanyOnboardingModal } from "../CompanyOnboardingModal";
import type { Agent, ProjectInfo, BoardSummary } from "../../api";
import { getCompanyOnboardingMarker } from "../company-onboarding-state";

vi.mock("../../api", () => ({
  registerProject: vi.fn(),
  createGoal: vi.fn(),
  createBoard: vi.fn(),
  fetchAgents: vi.fn(),
  updateAgent: vi.fn(),
  updateAgentInstructions: vi.fn(),
  browseDirectory: vi.fn(),
  addBoardColumn: vi.fn(),
  ApiRequestError: class extends Error {},
}));

// Keep the directory browser inert — the text input drives path entry.
vi.mock("../../hooks/useNodes", () => ({
  useNodes: () => ({ nodes: [], loading: false }),
}));

const mockRegister = vi.mocked(apiModule.registerProject);
const mockCreateGoal = vi.mocked(apiModule.createGoal);
const mockCreateBoard = vi.mocked(apiModule.createBoard);
const mockFetchAgents = vi.mocked(apiModule.fetchAgents);
const mockUpdateAgent = vi.mocked(apiModule.updateAgent);
const mockUpdateInstructions = vi.mocked(apiModule.updateAgentInstructions);

const PROJECT: ProjectInfo = {
  id: "proj-1",
  name: "Acme",
  path: "/tmp/acme",
  status: "active",
  isolationMode: "in-process",
  createdAt: "",
  updatedAt: "",
};

const BOARD: BoardSummary = {
  id: "board-1",
  name: "Engineering",
  description: "Builds the product",
  requirePlanApproval: false,
  lfgMode: false,
  ordering: 0,
};

function agent(id: string, role: string, name: string, instructions = ""): Agent {
  return {
    id, name, role, state: "idle", createdAt: "", updatedAt: "", metadata: {}, instructionsText: instructions,
  } as unknown as Agent;
}

function baseProps() {
  return {
    onProjectRegistered: vi.fn(),
    onClose: vi.fn(),
    addToast: vi.fn(),
    existingProjects: [],
  };
}

async function completeStep1() {
  fireEvent.change(screen.getByTestId("company-onboarding-name-input"), { target: { value: "Acme" } });
  // DirectoryPicker text input — find the path field by placeholder.
  const pathInput = screen.getByPlaceholderText("/path/to/your/project");
  fireEvent.change(pathInput, { target: { value: "/tmp/acme" } });
  fireEvent.click(screen.getByTestId("company-onboarding-next"));
  await waitFor(() => expect(mockRegister).toHaveBeenCalled());
}

describe("CompanyOnboardingModal (U12)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockRegister.mockResolvedValue(PROJECT);
    mockCreateBoard.mockResolvedValue({ board: BOARD, seeded: true });
    mockCreateGoal.mockResolvedValue({ id: "g1", title: "Ship v1", status: "active", createdAt: "", updatedAt: "" });
    mockUpdateAgent.mockImplementation(async (_id, updates) => agent("ceo-1", "ceo", (updates as { name?: string }).name ?? "CEO"));
    mockUpdateInstructions.mockImplementation(async (id) => agent(id, "lead", "Lead"));
    mockFetchAgents.mockImplementation(async (filter) => {
      if (filter?.role === "ceo") return [agent("ceo-1", "ceo", "CEO")];
      return [
        agent("lead-1", "lead", "Lead (Eng)"),
        agent("exec-1", "executor", "Executor (Eng)"),
        agent("rev-1", "reviewer", "Reviewer (Eng)"),
      ];
    });
  });

  it("starts at step 1 and registers the project, advancing to step 2 (meet the CEO)", async () => {
    render(<CompanyOnboardingModal {...baseProps()} />);
    expect(screen.getByTestId("company-onboarding-step-1")).toBeDefined();
    await completeStep1();
    await waitFor(() => expect(screen.getByTestId("company-onboarding-step-2")).toBeDefined());
    // CEO name prefilled from the seeded CEO.
    expect((screen.getByTestId("company-onboarding-ceo-name") as HTMLInputElement).value).toBe("CEO");
  });

  it("progresses through all five steps and persists a completed marker (never re-shown)", async () => {
    const props = baseProps();
    render(<CompanyOnboardingModal {...props} />);
    await completeStep1();

    // Step 2: rename CEO + set a goal.
    await waitFor(() => screen.getByTestId("company-onboarding-step-2"));
    fireEvent.change(screen.getByTestId("company-onboarding-ceo-name"), { target: { value: "Ada" } });
    fireEvent.change(screen.getByTestId("company-onboarding-goal-title"), { target: { value: "Ship v1" } });
    fireEvent.click(screen.getByTestId("company-onboarding-next"));
    await waitFor(() => expect(mockUpdateAgent).toHaveBeenCalledWith("ceo-1", expect.objectContaining({ name: "Ada" }), "proj-1"));
    await waitFor(() => expect(mockCreateGoal).toHaveBeenCalledWith({ title: "Ship v1" }, "proj-1"));

    // Step 3: create the first board.
    await waitFor(() => screen.getByTestId("company-onboarding-step-3"));
    fireEvent.change(screen.getByTestId("company-onboarding-board-name"), { target: { value: "Engineering" } });
    fireEvent.click(screen.getByTestId("company-onboarding-next"));
    await waitFor(() => expect(mockCreateBoard).toHaveBeenCalledWith({ name: "Engineering" }, "proj-1"));

    // Step 4: the three seeded role employees show.
    await waitFor(() => screen.getByTestId("company-onboarding-step-4"));
    await waitFor(() => expect(screen.getByTestId("company-onboarding-employee-lead")).toBeDefined());
    expect(screen.getByTestId("company-onboarding-employee-executor")).toBeDefined();
    expect(screen.getByTestId("company-onboarding-employee-reviewer")).toBeDefined();
    fireEvent.change(screen.getByTestId("company-onboarding-employee-instructions-lead"), { target: { value: "Plan well" } });
    fireEvent.click(screen.getByTestId("company-onboarding-next"));
    await waitFor(() => expect(mockUpdateInstructions).toHaveBeenCalledWith("lead-1", { instructionsText: "Plan well" }, "proj-1"));

    // Step 5: land on the board.
    await waitFor(() => screen.getByTestId("company-onboarding-step-5"));
    fireEvent.click(screen.getByTestId("company-onboarding-finish"));

    expect(props.onClose).toHaveBeenCalled();
    const marker = getCompanyOnboardingMarker("proj-1");
    expect(marker?.outcome).toBe("completed");
    // Landed on the created board (BoardSwitcher persistence key, U10).
    expect(localStorage.getItem("kb-dashboard-selected-board:proj-1")).toBe("board-1");
  });

  it("skipping at step 2 still keeps the created project and marks onboarding done as skipped", async () => {
    const props = baseProps();
    render(<CompanyOnboardingModal {...props} />);
    await completeStep1();
    await waitFor(() => screen.getByTestId("company-onboarding-step-2"));

    fireEvent.click(screen.getByTestId("company-onboarding-skip"));

    expect(props.onProjectRegistered).toHaveBeenCalledWith(PROJECT);
    expect(mockCreateBoard).not.toHaveBeenCalled(); // no board → default board behavior applies server-side
    expect(props.onClose).toHaveBeenCalled();
    const marker = getCompanyOnboardingMarker("proj-1");
    expect(marker?.outcome).toBe("skipped");
    expect(marker?.atStep).toBe(2);
  });

  it("skipping at step 1 (before the project exists) does not persist a marker and never blocks", async () => {
    const props = baseProps();
    render(<CompanyOnboardingModal {...props} />);
    expect(screen.getByTestId("company-onboarding-step-1")).toBeDefined();

    fireEvent.click(screen.getByTestId("company-onboarding-skip"));

    expect(mockRegister).not.toHaveBeenCalled();
    expect(props.onClose).toHaveBeenCalled();
    // No project id yet → no marker (the wizard simply closed without creating anything).
    expect(getCompanyOnboardingMarker("proj-1")).toBeNull();
  });

  it("includes custom-role employees on the step-4 initial load (parity with onColumnAdded)", async () => {
    // Regression: the step-4 initial load filtered only lead/executor/reviewer,
    // so a re-mount dropped custom-role employees that onColumnAdded surfaces.
    mockFetchAgents.mockImplementation(async (filter) => {
      if (filter?.role === "ceo") return [agent("ceo-1", "ceo", "CEO")];
      return [
        agent("lead-1", "lead", "Lead (Eng)"),
        agent("exec-1", "executor", "Executor (Eng)"),
        agent("rev-1", "reviewer", "Reviewer (Eng)"),
        agent("custom-1", "custom", "QA Specialist"),
      ];
    });
    render(<CompanyOnboardingModal {...baseProps()} />);
    await completeStep1();
    await waitFor(() => screen.getByTestId("company-onboarding-step-2"));
    fireEvent.click(screen.getByTestId("company-onboarding-next"));
    await waitFor(() => screen.getByTestId("company-onboarding-step-3"));
    fireEvent.change(screen.getByTestId("company-onboarding-board-name"), { target: { value: "Engineering" } });
    fireEvent.click(screen.getByTestId("company-onboarding-next"));
    await waitFor(() => screen.getByTestId("company-onboarding-step-4"));
    await waitFor(() => expect(screen.getByTestId("company-onboarding-employee-custom")).toBeDefined());
  });

  it("shows a skip control on every step before the final step", async () => {
    render(<CompanyOnboardingModal {...baseProps()} />);
    expect(screen.getByTestId("company-onboarding-skip")).toBeDefined();
    await completeStep1();
    await waitFor(() => screen.getByTestId("company-onboarding-step-2"));
    expect(screen.getByTestId("company-onboarding-skip")).toBeDefined();
  });
});
