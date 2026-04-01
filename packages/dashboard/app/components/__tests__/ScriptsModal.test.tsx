import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ScriptsModal } from "../ScriptsModal";

const mockScripts: Record<string, string> = {
  build: "npm run build",
  test: "pnpm test",
  lint: "eslint src/",
};

vi.mock("../../api", () => ({
  fetchScripts: vi.fn(() => Promise.resolve({})),
  addScript: vi.fn(() => Promise.resolve({})),
  removeScript: vi.fn(() => Promise.resolve({})),
}));

import { fetchScripts, addScript, removeScript } from "../../api";

const onClose = vi.fn();
const addToast = vi.fn();
const onRunScript = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ScriptsModal", () => {
  it("does not render when closed", () => {
    const { container } = render(
      <ScriptsModal isOpen={false} onClose={onClose} addToast={addToast} />
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders list of scripts", async () => {
    vi.mocked(fetchScripts).mockResolvedValueOnce(mockScripts);

    render(<ScriptsModal isOpen={true} onClose={onClose} addToast={addToast} />);

    await waitFor(() => {
      expect(screen.getByText("build")).toBeInTheDocument();
      expect(screen.getByText("test")).toBeInTheDocument();
      expect(screen.getByText("lint")).toBeInTheDocument();
    });
  });

  it("shows empty state when no scripts exist", async () => {
    vi.mocked(fetchScripts).mockResolvedValueOnce({});

    render(<ScriptsModal isOpen={true} onClose={onClose} addToast={addToast} />);

    await waitFor(() => {
      expect(screen.getByTestId("scripts-empty-state")).toBeInTheDocument();
      expect(screen.getByText(/No scripts defined yet/)).toBeInTheDocument();
    });
  });

  it("opens create form when Add button is clicked", async () => {
    vi.mocked(fetchScripts).mockResolvedValueOnce({});

    render(<ScriptsModal isOpen={true} onClose={onClose} addToast={addToast} />);

    await waitFor(() => {
      expect(screen.getByTestId("scripts-empty-state")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("add-script-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("script-form")).toBeInTheDocument();
      expect(screen.getByText("New Script")).toBeInTheDocument();
    });
  });

  it("validates script name - rejects empty name (button disabled)", async () => {
    vi.mocked(fetchScripts).mockResolvedValueOnce({});

    render(<ScriptsModal isOpen={true} onClose={onClose} addToast={addToast} />);

    await waitFor(() => {
      expect(screen.getByTestId("scripts-empty-state")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("add-script-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("script-form")).toBeInTheDocument();
    });

    // Fill in command only
    fireEvent.change(screen.getByTestId("script-command-input"), {
      target: { value: "echo hello" },
    });

    // Save button should be disabled when name is empty
    const saveButton = screen.getByTestId("save-script-btn") as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);
  });

  it("validates script name - rejects invalid characters", async () => {
    vi.mocked(fetchScripts).mockResolvedValueOnce({});

    render(<ScriptsModal isOpen={true} onClose={onClose} addToast={addToast} />);

    await waitFor(() => {
      expect(screen.getByTestId("scripts-empty-state")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("add-script-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("script-form")).toBeInTheDocument();
    });

    // Fill in name with spaces
    fireEvent.change(screen.getByTestId("script-name-input"), {
      target: { value: "my script" },
    });

    fireEvent.change(screen.getByTestId("script-command-input"), {
      target: { value: "echo hello" },
    });

    // Click save
    fireEvent.click(screen.getByTestId("save-script-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("script-validation-error")).toBeInTheDocument();
      expect(
        screen.getByText(/Name must be alphanumeric with hyphens and underscores only/)
      ).toBeInTheDocument();
    });
  });

  it("validates script name - rejects reserved names", async () => {
    vi.mocked(fetchScripts).mockResolvedValueOnce({});

    render(<ScriptsModal isOpen={true} onClose={onClose} addToast={addToast} />);

    await waitFor(() => {
      expect(screen.getByTestId("scripts-empty-state")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("add-script-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("script-form")).toBeInTheDocument();
    });

    // Fill in reserved name
    fireEvent.change(screen.getByTestId("script-name-input"), {
      target: { value: "run" },
    });

    fireEvent.change(screen.getByTestId("script-command-input"), {
      target: { value: "echo hello" },
    });

    // Click save
    fireEvent.click(screen.getByTestId("save-script-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("script-validation-error")).toBeInTheDocument();
      expect(screen.getByText(/Script name 'run' is reserved/)).toBeInTheDocument();
    });
  });

  it("creates a new script successfully", async () => {
    vi.mocked(fetchScripts).mockResolvedValueOnce({});
    vi.mocked(addScript).mockResolvedValueOnce({ deploy: "npm run deploy" });

    render(<ScriptsModal isOpen={true} onClose={onClose} addToast={addToast} />);

    await waitFor(() => {
      expect(screen.getByTestId("scripts-empty-state")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("add-script-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("script-form")).toBeInTheDocument();
    });

    // Fill in form
    fireEvent.change(screen.getByTestId("script-name-input"), {
      target: { value: "deploy" },
    });

    fireEvent.change(screen.getByTestId("script-command-input"), {
      target: { value: "npm run deploy" },
    });

    // Click save
    fireEvent.click(screen.getByTestId("save-script-btn"));

    await waitFor(() => {
      expect(addScript).toHaveBeenCalledWith("deploy", "npm run deploy");
      expect(addToast).toHaveBeenCalledWith("Script 'deploy' created", "success");
    });
  });

  it("runs a script when run button is clicked", async () => {
    vi.mocked(fetchScripts).mockResolvedValueOnce(mockScripts);

    render(
      <ScriptsModal
        isOpen={true}
        onClose={onClose}
        addToast={addToast}
        onRunScript={onRunScript}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("build")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("run-script-build"));

    await waitFor(() => {
      expect(onRunScript).toHaveBeenCalledWith("build", "npm run build");
    });
  });

  it("deletes a script with confirmation", async () => {
    vi.mocked(fetchScripts).mockResolvedValueOnce(mockScripts);
    vi.mocked(removeScript).mockResolvedValueOnce({ test: "pnpm test", lint: "eslint src/" });

    render(<ScriptsModal isOpen={true} onClose={onClose} addToast={addToast} />);

    await waitFor(() => {
      expect(screen.getByText("build")).toBeInTheDocument();
    });

    // Click delete button
    fireEvent.click(screen.getByTestId("delete-script-build"));

    // Should show confirm/cancel buttons
    await waitFor(() => {
      expect(screen.getByTitle("Confirm delete")).toBeInTheDocument();
      expect(screen.getByTitle("Cancel delete")).toBeInTheDocument();
    });

    // Click confirm
    fireEvent.click(screen.getByTitle("Confirm delete"));

    await waitFor(() => {
      expect(removeScript).toHaveBeenCalledWith("build");
      expect(addToast).toHaveBeenCalledWith("Script 'build' deleted", "success");
    });
  });

  it("cancels delete when cancel button is clicked", async () => {
    vi.mocked(fetchScripts).mockResolvedValueOnce(mockScripts);

    render(<ScriptsModal isOpen={true} onClose={onClose} addToast={addToast} />);

    await waitFor(() => {
      expect(screen.getByText("build")).toBeInTheDocument();
    });

    // Click delete button
    fireEvent.click(screen.getByTestId("delete-script-build"));

    // Should show confirm/cancel buttons
    await waitFor(() => {
      expect(screen.getByTitle("Cancel delete")).toBeInTheDocument();
    });

    // Click cancel
    fireEvent.click(screen.getByTitle("Cancel delete"));

    // Delete should not have been called
    expect(removeScript).not.toHaveBeenCalled();
  });

  it("handles API errors gracefully", async () => {
    vi.mocked(fetchScripts).mockRejectedValueOnce(new Error("Failed to fetch"));

    render(<ScriptsModal isOpen={true} onClose={onClose} addToast={addToast} />);

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith("Failed to fetch", "error");
    });
  });

  it("shows loading state while fetching scripts", async () => {
    vi.mocked(fetchScripts).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({}), 100))
    );

    render(<ScriptsModal isOpen={true} onClose={onClose} addToast={addToast} />);

    expect(screen.getByTestId("scripts-loading")).toBeInTheDocument();
  });

  it("edits an existing script", async () => {
    vi.mocked(fetchScripts).mockResolvedValueOnce(mockScripts);
    vi.mocked(addScript).mockResolvedValueOnce({ build: "npm run build:prod", test: "pnpm test" });

    render(<ScriptsModal isOpen={true} onClose={onClose} addToast={addToast} />);

    await waitFor(() => {
      expect(screen.getByText("build")).toBeInTheDocument();
    });

    // Click edit button
    fireEvent.click(screen.getByTestId("edit-script-build"));

    await waitFor(() => {
      expect(screen.getByTestId("script-form")).toBeInTheDocument();
      expect(screen.getByText("Edit Script")).toBeInTheDocument();
    });

    // Name should be disabled for editing
    const nameInput = screen.getByTestId("script-name-input") as HTMLInputElement;
    expect(nameInput.disabled).toBe(true);

    // Change command
    fireEvent.change(screen.getByTestId("script-command-input"), {
      target: { value: "npm run build:prod" },
    });

    // Click save
    fireEvent.click(screen.getByTestId("save-script-btn"));

    await waitFor(() => {
      expect(addScript).toHaveBeenCalledWith("build", "npm run build:prod");
      expect(addToast).toHaveBeenCalledWith("Script 'build' updated", "success");
    });
  });
});
