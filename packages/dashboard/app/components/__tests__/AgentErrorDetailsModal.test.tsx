import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentErrorDetailsModal, AgentErrorIndicator } from "../AgentErrorDetailsModal";
import { loadAllAppCss } from "../../test/cssFixture";

const issueContext = {
  surface: "AgentsView",
  agentId: "agent-1",
  agentName: "Test Agent",
  agentState: "error",
  runId: "run-1",
  taskId: "FN-1",
  timestamp: "2026-01-01T00:00:00.000Z",
};

describe("AgentErrorDetailsModal", () => {
  const originalClipboard = navigator.clipboard;
  const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
    openSpy.mockClear();
  });

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", { value: originalClipboard, configurable: true });
  });

  it("does not render when closed", () => {
    const { container } = render(<AgentErrorDetailsModal open={false} onClose={vi.fn()} errorText="boom" issueContext={issueContext} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders long error text in scrollable error region", () => {
    render(<AgentErrorDetailsModal open={true} onClose={vi.fn()} errorText={"stderr\n".repeat(200)} issueContext={issueContext} />);
    const errorRegion = document.querySelector(".agent-error-modal__error");
    expect(errorRegion).toBeInTheDocument();
    expect(errorRegion).toHaveTextContent("stderr");
  });

  it("copies error text", async () => {
    const user = userEvent.setup();
    render(<AgentErrorDetailsModal open={true} onClose={vi.fn()} errorText="copy me" issueContext={issueContext} />);

    await user.click(screen.getByRole("button", { name: "Copy error to clipboard" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Copied error to clipboard" })).toBeInTheDocument();
    });
  });

  it("opens github report link", async () => {
    const user = userEvent.setup();
    render(<AgentErrorDetailsModal open={true} onClose={vi.fn()} errorText="report me" issueContext={issueContext} />);

    await user.click(screen.getByRole("link", { name: /report on github/i }));
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy.mock.calls[0]?.[0]).toContain("https://github.com/Runfusion/Fusion/issues/new?");
  });

  it("AgentErrorIndicator opens shared modal", async () => {
    const user = userEvent.setup();
    render(<AgentErrorIndicator errorText="indicator error" issueContext={issueContext} />);
    await user.click(screen.getByRole("button", { name: "Open error details" }));
    expect(screen.getByRole("dialog", { name: "Agent error details" })).toBeInTheDocument();
  });

  describe("mobile layout", () => {
    it("keeps error content scrollable and protects modal footer from mobile clipping regression", async () => {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: 375 });
      window.dispatchEvent(new Event("resize"));

      render(
        <AgentErrorDetailsModal
          open={true}
          onClose={vi.fn()}
          errorText={"stderr line\n".repeat(400)}
          issueContext={issueContext}
        />,
      );

      const errorRegion = document.querySelector(".agent-error-modal__error");
      expect(errorRegion).toBeInTheDocument();
      expect(errorRegion).toHaveStyle({ overflow: "auto" });

      const actions = document.querySelector(".modal-actions");
      expect(actions).toBeInTheDocument();
      expect(errorRegion?.compareDocumentPosition(actions as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

      const allCss = await loadAllAppCss();
      const mobileBlockStart = allCss.indexOf("@media[^{]*(max-width: 768px)[^{]*{\n  .agent-error-modal {");
      expect(mobileBlockStart).toBeGreaterThanOrEqual(0);
      const mobileBlockEnd = allCss.indexOf("}\n", mobileBlockStart + 1);
      const mobileBlock = allCss.slice(mobileBlockStart, mobileBlockEnd > mobileBlockStart ? mobileBlockEnd : undefined);

      expect(mobileBlock).toContain("--mobile-nav-height");
      expect(mobileBlock).toContain("--standalone-bottom-gap");
      expect(mobileBlock).toContain("env(safe-area-inset-bottom");
      expect(mobileBlock).not.toMatch(/height:\s*100%\s*;/);
      expect(mobileBlock).not.toMatch(/max-height:\s*100%\s*;/);
    });
  });
});
