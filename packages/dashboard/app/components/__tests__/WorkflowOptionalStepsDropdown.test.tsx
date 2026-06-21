import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { useState } from "react";
import type { ResolvedWorkflowOptionalStep } from "@fusion/core";
import { WorkflowOptionalStepsDropdown } from "../WorkflowOptionalStepsDropdown";

const STEP: ResolvedWorkflowOptionalStep = {
  templateId: "browser-verification",
  name: "Browser Verification",
  description: "Verify web application functionality using browser automation",
  icon: "globe",
  phase: "pre-merge",
  defaultOn: false,
};

// Controlled host: parent owns the enabled set, mirroring the create surfaces.
function Host({ steps, initial = [] }: { steps: ResolvedWorkflowOptionalStep[]; initial?: string[] }) {
  const [enabled, setEnabled] = useState<string[]>(initial);
  return (
    <WorkflowOptionalStepsDropdown
      steps={steps}
      enabledIds={enabled}
      onToggle={(id) =>
        setEnabled((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
      }
    />
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("WorkflowOptionalStepsDropdown", () => {
  it("renders nothing when there are no optional steps", () => {
    const { container } = render(<Host steps={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("reflects the selected count in the trigger label", () => {
    render(<Host steps={[STEP]} />);
    const trigger = screen.getByTestId("wf-optional-steps-dropdown-trigger");
    expect(trigger).toHaveTextContent("Steps: none");
  });

  it("opens, toggles a step, and updates the trigger count", () => {
    render(<Host steps={[STEP]} />);
    const trigger = screen.getByTestId("wf-optional-steps-dropdown-trigger");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    const option = screen.getByTestId("wf-optional-steps-dropdown-option-browser-verification");
    expect(option).toHaveAttribute("role", "option");
    expect(option).toHaveAttribute("aria-checked", "false");
    fireEvent.click(option);
    expect(screen.getByTestId("wf-optional-steps-dropdown-option-browser-verification")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(trigger).toHaveTextContent("Steps: 1 selected");
  });

  it("pre-checks a step seeded as enabled by the parent (defaultOn)", () => {
    render(<Host steps={[STEP]} initial={["browser-verification"]} />);
    fireEvent.click(screen.getByTestId("wf-optional-steps-dropdown-trigger"));
    expect(screen.getByTestId("wf-optional-steps-dropdown-option-browser-verification")).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("exposes the panel as an accessible listbox labelled by the trigger", () => {
    render(<Host steps={[STEP]} />);
    fireEvent.click(screen.getByTestId("wf-optional-steps-dropdown-trigger"));
    const panel = screen.getByTestId("wf-optional-steps-dropdown-panel");
    expect(panel).toHaveAttribute("role", "listbox");
    expect(within(panel).getByText("Browser Verification")).toBeTruthy();
  });

  it("closes on Escape", () => {
    render(<Host steps={[STEP]} />);
    const trigger = screen.getByTestId("wf-optional-steps-dropdown-trigger");
    fireEvent.click(trigger);
    const panel = screen.getByTestId("wf-optional-steps-dropdown-panel");
    fireEvent.keyDown(panel, { key: "Escape" });
    expect(screen.queryByTestId("wf-optional-steps-dropdown-panel")).toBeNull();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("closes on outside click without losing selection", () => {
    render(
      <div>
        <Host steps={[STEP]} initial={["browser-verification"]} />
        <button data-testid="outside">outside</button>
      </div>,
    );
    const trigger = screen.getByTestId("wf-optional-steps-dropdown-trigger");
    fireEvent.click(trigger);
    expect(screen.getByTestId("wf-optional-steps-dropdown-panel")).toBeTruthy();
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(screen.queryByTestId("wf-optional-steps-dropdown-panel")).toBeNull();
    // Selection preserved.
    expect(trigger).toHaveTextContent("Steps: 1 selected");
  });
});
