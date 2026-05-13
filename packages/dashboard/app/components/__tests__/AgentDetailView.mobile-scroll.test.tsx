import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { loadAllAppCss } from "../../test/cssFixture";
import { setupAgentDetailMocks } from "./AgentDetailView.test-helpers";
import { AgentDetailView } from "../AgentDetailView";

describe("AgentDetailView mobile scroll regression (FN-4231)", () => {
  beforeEach(() => {
    setupAgentDetailMocks();
    document.head.querySelector("style[data-testid='fn-4231-css']")?.remove();
    const style = document.createElement("style");
    style.setAttribute("data-testid", "fn-4231-css");
    style.textContent = loadAllAppCss();
    document.head.appendChild(style);

    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query.includes("max-width: 768px"),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it("keeps AgentDetailView tab body as the mobile scroll owner (FN-4231)", async () => {
    render(<AgentDetailView agentId="agent-001" onClose={vi.fn()} addToast={vi.fn()} />);

    await waitFor(() => {
      expect(document.querySelector(".agent-detail-content")).toBeTruthy();
    });

    const contentEl = document.querySelector(".agent-detail-content") as HTMLElement;
    const tabsEl = document.querySelector(".agent-detail-tabs") as HTMLElement;
    const footerEl = document.querySelector(".agent-detail-footer") as HTMLElement;

    expect(window.getComputedStyle(contentEl).minHeight).toBe("0px");
    expect(window.getComputedStyle(contentEl).overflowY).toBe("auto");
    expect(window.getComputedStyle(tabsEl).flexShrink).toBe("0");
    expect(window.getComputedStyle(footerEl).flexShrink).toBe("0");
  });
});
