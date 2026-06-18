import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { loadStylesCss } from "../../../test/cssFixture";
import { CommandCenter } from "../CommandCenter";

const apiMock = vi.fn();
vi.mock("../../../api/legacy", () => ({
  api: (path: string, opts?: RequestInit) => apiMock(path, opts),
}));

function emptyTokenFixture() {
  return {
    totals: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, totalTokens: 0, nTasks: 0 },
    cost: { usd: null, unavailable: true, stale: false },
    groups: [],
  };
}

function emptyToolsFixture() {
  return {
    toolCalls: 0,
    byCategory: [],
    sessions: 0,
    interventions: { approvals: 0, userSteers: 0, total: 0 },
    autonomyRatio: 0,
    fullyAutonomous: true,
  };
}

function emptyActivityFixture() {
  return {
    sessions: 0,
    messages: 0,
    activeNodes: 0,
    activeAgents: 0,
    daily: [],
    stickiness: 0,
    mttr: { value: null, unavailable: true },
    monitor: { mttr: { value: null, unavailable: true }, incidents: 0, deployments: 0 },
    funnel: {
      stages: [
        { stage: "triage", entered: 0, current: 0 },
        { stage: "done", entered: 0, current: 0 },
      ],
      enteredInRange: 0,
      doneInRange: 0,
      completionRate: 0,
      throughputPerDay: 0,
      rangeDays: 7,
    },
  };
}

function mockEmptyOverviewApi() {
  apiMock.mockImplementation((path: string) => {
    if (path.startsWith("/command-center/tokens")) return Promise.resolve(emptyTokenFixture());
    if (path.startsWith("/command-center/tools")) return Promise.resolve(emptyToolsFixture());
    if (path.startsWith("/command-center/activity")) return Promise.resolve(emptyActivityFixture());
    if (path.startsWith("/command-center/signals")) return Promise.resolve({ totalSignals: 0, open: 0, resolved: 0, mttr: { value: null, unavailable: true }, bySource: [], bySeverity: [] });
    return Promise.reject(new Error(`Unhandled api path: ${path}`));
  });
}

function injectCommandCenterCss() {
  document.head.querySelector("style[data-testid='fn-6595-css']")?.remove();
  const style = document.createElement("style");
  style.setAttribute("data-testid", "fn-6595-css");
  style.textContent = [
    loadStylesCss(),
    readFileSync(join(__dirname, "..", "CommandCenter.css"), "utf-8"),
  ].join("\n");
  document.head.appendChild(style);
}

function mockMobileMatchMedia(matchesMobile: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: matchesMobile && query.includes("max-width: 768px"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function assertScrollOwnerContract(panel: HTMLElement) {
  const shell = screen.getByTestId("command-center");
  const header = shell.querySelector(".cc-header") as HTMLElement;
  const tablist = screen.getByRole("tablist");

  const shellStyle = window.getComputedStyle(shell);
  const panelStyle = window.getComputedStyle(panel);

  expect(shellStyle.flexGrow).toBe("1");
  expect(shellStyle.minHeight).toBe("0px");
  expect(panelStyle.minHeight).toBe("0px");
  expect(panelStyle.overflowY).toBe("auto");
  expect(window.getComputedStyle(header).flexShrink).toBe("0");
  expect(window.getComputedStyle(tablist).flexShrink).toBe("0");
}

describe("CommandCenter mobile scroll regression (FN-6595)", () => {
  beforeEach(() => {
    apiMock.mockReset();
    mockEmptyOverviewApi();
    injectCommandCenterCss();
    mockMobileMatchMedia(true);
  });

  it("keeps the tabpanel as the mobile scroll owner with pinned header and tabs", async () => {
    render(<CommandCenter />);

    const overviewPanel = screen.getByTestId("command-center-panel-overview");
    await screen.findByTestId("command-center-empty");
    assertScrollOwnerContract(overviewPanel);

    fireEvent.click(screen.getByTestId("command-center-tab-tokens"));
    const tokensPanel = screen.getByTestId("command-center-panel-tokens");
    expect(tokensPanel).toBe(screen.getByRole("tabpanel"));
    assertScrollOwnerContract(tokensPanel);
  });

  it("keeps the same flex-fill scroll-owner contract outside the mobile breakpoint", () => {
    mockMobileMatchMedia(false);
    render(<CommandCenter />);

    assertScrollOwnerContract(screen.getByTestId("command-center-panel-overview"));
  });
});
