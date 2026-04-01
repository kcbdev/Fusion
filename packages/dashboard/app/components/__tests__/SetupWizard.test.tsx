import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SetupWizardModal } from "../SetupWizardModal";

// Mock the API
const mockRegisterProject = vi.fn();

vi.mock("../api", () => ({
  registerProject: (...args: unknown[]) => mockRegisterProject(...args),
}));

// Mock lucide-react icons
vi.mock("lucide-react", () => ({
  X: () => <span data-testid="x-icon">×</span>,
  Loader2: () => <span data-testid="loader-icon">⟳</span>,
  FolderPlus: () => <span data-testid="folder-icon">📁</span>,
  CheckCircle: () => <span data-testid="check-icon">✓</span>,
}));

const noop = () => {};

describe("SetupWizardModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("renders the wizard with manual step by default", async () => {
    render(
      <SetupWizardModal
        onProjectRegistered={noop}
        onClose={noop}
      />
    );

    // Should show welcome/manual screen
    expect(await screen.findByText("Welcome to kb")).toBeDefined();

    // Should show manual entry form
    expect(screen.getByLabelText("Project Path")).toBeDefined();
    expect(screen.getByLabelText("Project Name")).toBeDefined();
    expect(screen.getByLabelText("Isolation Mode")).toBeDefined();
  });

  it("allows entering project details in manual step", async () => {
    render(
      <SetupWizardModal
        onProjectRegistered={noop}
        onClose={noop}
      />
    );

    const pathInput = await screen.findByLabelText("Project Path");
    
    fireEvent.change(pathInput, { target: { value: "/path/to/project" } });

    expect(pathInput).toHaveValue("/path/to/project");
  });

  it("calls onClose when close button is clicked", async () => {
    const onClose = vi.fn();

    render(
      <SetupWizardModal
        onProjectRegistered={noop}
        onClose={onClose}
      />
    );

    const closeButton = await screen.findByLabelText("Close wizard");
    fireEvent.click(closeButton);

    expect(onClose).toHaveBeenCalled();
  });

  it("disables register button when form is incomplete", async () => {
    render(
      <SetupWizardModal
        onProjectRegistered={noop}
        onClose={noop}
      />
    );

    // Wait for form to render
    await screen.findByLabelText("Project Path");
    
    const registerButton = screen.getByRole("button", { name: /register project/i });
    expect(registerButton).toBeDisabled();

    // Fill only path
    fireEvent.change(screen.getByLabelText("Project Path"), {
      target: { value: "/path/to/project" },
    });

    // Button should still be disabled
    expect(registerButton).toBeDisabled();
  });

  it("enables register button when form is complete", async () => {
    render(
      <SetupWizardModal
        onProjectRegistered={noop}
        onClose={noop}
      />
    );

    // Wait for form to render
    await screen.findByLabelText("Project Path");

    // Fill the form
    fireEvent.change(screen.getByLabelText("Project Path"), {
      target: { value: "/path/to/project" },
    });
    fireEvent.change(screen.getByLabelText("Project Name"), {
      target: { value: "test-project" },
    });

    // Wait for button to be enabled
    const registerButton = screen.getByRole("button", { name: /register project/i });
    await waitFor(() => expect(registerButton).not.toBeDisabled());
  });

  it("has isolation mode selector with correct options", async () => {
    render(
      <SetupWizardModal
        onProjectRegistered={noop}
        onClose={noop}
      />
    );

    const select = await screen.findByLabelText("Isolation Mode") as HTMLSelectElement;
    expect(select.value).toBe("in-process");

    // Check options exist
    const options = Array.from(select.options);
    expect(options.some(opt => opt.value === "in-process")).toBe(true);
    expect(options.some(opt => opt.value === "child-process")).toBe(true);
  });

  it("shows form hint for project path", async () => {
    render(
      <SetupWizardModal
        onProjectRegistered={noop}
        onClose={noop}
      />
    );

    expect(await screen.findByText("Absolute path to your project directory")).toBeDefined();
  });

  it("has correct isolation mode default value", async () => {
    render(
      <SetupWizardModal
        onProjectRegistered={noop}
        onClose={noop}
      />
    );

    const select = await screen.findByLabelText("Isolation Mode") as HTMLSelectElement;
    expect(select.value).toBe("in-process");
  });
});
