import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PlanningModeModal } from "./PlanningModeModal";
import type { Task, PlanningQuestion, PlanningSummary } from "@kb/core";

// Mock the API functions
const mockStartPlanning = vi.fn();
const mockRespondToPlanning = vi.fn();
const mockCancelPlanning = vi.fn();
const mockCreateTaskFromPlanning = vi.fn();

vi.mock("../api", () => ({
  startPlanning: (...args: any[]) => mockStartPlanning(...args),
  respondToPlanning: (...args: any[]) => mockRespondToPlanning(...args),
  cancelPlanning: (...args: any[]) => mockCancelPlanning(...args),
  createTaskFromPlanning: (...args: any[]) => mockCreateTaskFromPlanning(...args),
}));

const mockTasks: Task[] = [
  {
    id: "KB-001",
    description: "Existing task 1",
    column: "todo",
    dependencies: [],
    steps: [],
    currentStep: 0,
    log: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

const mockQuestion: PlanningQuestion = {
  id: "q-scope",
  type: "single_select",
  question: "What is the scope?",
  description: "Choose the scope of this task",
  options: [
    { id: "small", label: "Small" },
    { id: "medium", label: "Medium" },
    { id: "large", label: "Large" },
  ],
};

const mockSummary: PlanningSummary = {
  title: "Build authentication system",
  description: "Implement user auth with login and signup",
  suggestedSize: "M",
  suggestedDependencies: [],
  keyDeliverables: ["Login page", "Signup page", "Auth API"],
};

describe("PlanningModeModal", () => {
  const mockOnClose = vi.fn();
  const mockOnTaskCreated = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  describe("Initial view", () => {
    it("renders the initial input view when open", () => {
      render(
        <PlanningModeModal
          isOpen={true}
          onClose={mockOnClose}
          onTaskCreated={mockOnTaskCreated}
          tasks={mockTasks}
        />
      );

      expect(screen.getByText("Planning Mode")).toBeDefined();
      expect(screen.getByPlaceholderText(/e.g., Build a user authentication/)).toBeDefined();
    });

    it("does not render when closed", () => {
      render(
        <PlanningModeModal
          isOpen={false}
          onClose={mockOnClose}
          onTaskCreated={mockOnTaskCreated}
          tasks={mockTasks}
        />
      );

      expect(screen.queryByText("Planning Mode")).toBeNull();
    });

    it("enables start button when text is entered", () => {
      render(
        <PlanningModeModal
          isOpen={true}
          onClose={mockOnClose}
          onTaskCreated={mockOnTaskCreated}
          tasks={mockTasks}
        />
      );

      const startButton = screen.getByText("Start Planning");
      expect(startButton.closest("button")?.hasAttribute("disabled")).toBe(true);

      const textarea = screen.getByPlaceholderText(/e.g., Build a user authentication/);
      fireEvent.change(textarea, { target: { value: "Test plan" } });

      expect(startButton.closest("button")?.hasAttribute("disabled")).toBe(false);
    });

    it("shows example chips", () => {
      render(
        <PlanningModeModal
          isOpen={true}
          onClose={mockOnClose}
          onTaskCreated={mockOnTaskCreated}
          tasks={mockTasks}
        />
      );

      expect(screen.getByText(/Build a user authentication/)).toBeDefined();
    });
  });

  describe("Planning flow", () => {
    it("starts planning and shows question view", async () => {
      mockStartPlanning.mockResolvedValue({
        sessionId: "session-123",
        currentQuestion: mockQuestion,
        summary: null,
      });

      render(
        <PlanningModeModal
          isOpen={true}
          onClose={mockOnClose}
          onTaskCreated={mockOnTaskCreated}
          tasks={mockTasks}
        />
      );

      const textarea = screen.getByPlaceholderText(/e.g., Build a user authentication/);
      fireEvent.change(textarea, { target: { value: "Build auth system" } });

      fireEvent.click(screen.getByText("Start Planning"));

      await waitFor(() => {
        expect(screen.getByText("What is the scope?")).toBeDefined();
      });

      expect(mockStartPlanning).toHaveBeenCalledWith("Build auth system");
    });

    it("shows error message when planning fails", async () => {
      mockStartPlanning.mockRejectedValue(new Error("Rate limit exceeded"));

      render(
        <PlanningModeModal
          isOpen={true}
          onClose={mockOnClose}
          onTaskCreated={mockOnTaskCreated}
          tasks={mockTasks}
        />
      );

      const textarea = screen.getByPlaceholderText(/e.g., Build a user authentication/);
      fireEvent.change(textarea, { target: { value: "Build auth system" } });

      fireEvent.click(screen.getByText("Start Planning"));

      await waitFor(() => {
        expect(screen.getByText("Rate limit exceeded")).toBeDefined();
      });
    });
  });

  describe("Question view", () => {
    it("renders single_select question with options", async () => {
      mockStartPlanning.mockResolvedValue({
        sessionId: "session-123",
        currentQuestion: mockQuestion,
        summary: null,
      });

      render(
        <PlanningModeModal
          isOpen={true}
          onClose={mockOnClose}
          onTaskCreated={mockOnTaskCreated}
          tasks={mockTasks}
        />
      );

      const textarea = screen.getByPlaceholderText(/e.g., Build a user authentication/);
      fireEvent.change(textarea, { target: { value: "Build auth system" } });
      fireEvent.click(screen.getByText("Start Planning"));

      await waitFor(() => {
        expect(screen.getByText("Small")).toBeDefined();
        expect(screen.getByText("Medium")).toBeDefined();
        expect(screen.getByText("Large")).toBeDefined();
      });
    });
  });

  describe("Summary view", () => {
    it("shows summary when planning is complete", async () => {
      mockStartPlanning.mockResolvedValue({
        sessionId: "session-123",
        currentQuestion: null,
        summary: mockSummary,
      });

      render(
        <PlanningModeModal
          isOpen={true}
          onClose={mockOnClose}
          onTaskCreated={mockOnTaskCreated}
          tasks={mockTasks}
        />
      );

      const textarea = screen.getByPlaceholderText(/e.g., Build a user authentication/);
      fireEvent.change(textarea, { target: { value: "Build auth system" } });
      fireEvent.click(screen.getByText("Start Planning"));

      await waitFor(() => {
        expect(screen.getByText("Planning Complete!")).toBeDefined();
      });
    });

    it("creates task from summary", async () => {
      const createdTask: Task = {
        id: "KB-042",
        title: "Build authentication system",
        description: "Implement user auth with login and signup",
        column: "triage",
        dependencies: [],
        steps: [],
        currentStep: 0,
        log: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      };

      mockStartPlanning.mockResolvedValue({
        sessionId: "session-123",
        currentQuestion: null,
        summary: mockSummary,
      });

      mockCreateTaskFromPlanning.mockResolvedValue(createdTask);

      render(
        <PlanningModeModal
          isOpen={true}
          onClose={mockOnClose}
          onTaskCreated={mockOnTaskCreated}
          tasks={mockTasks}
        />
      );

      const textarea = screen.getByPlaceholderText(/e.g., Build a user authentication/);
      fireEvent.change(textarea, { target: { value: "Build auth system" } });
      fireEvent.click(screen.getByText("Start Planning"));

      await waitFor(() => {
        expect(screen.getByText("Create Task")).toBeDefined();
      });

      fireEvent.click(screen.getByText("Create Task"));

      await waitFor(() => {
        expect(mockCreateTaskFromPlanning).toHaveBeenCalledWith("session-123");
        expect(mockOnTaskCreated).toHaveBeenCalledWith(createdTask);
      });
    });
  });
});
