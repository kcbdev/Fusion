import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { OrgTreeNode } from "@fusion/core";
import { CommandCenterControls } from "../CommandCenterControls";

const mocks = vi.hoisted(() => ({
  fetchOrgTree: vi.fn(),
  fetchExecutorStats: vi.fn(),
  fetchSettings: vi.fn(),
  fetchConfig: vi.fn(),
  updateSettings: vi.fn(),
  toggleGlobalPause: vi.fn(),
  toggleEnginePause: vi.fn(),
  refresh: vi.fn(),
  appSettings: {
    globalPaused: false,
    enginePaused: false,
  },
}));

vi.mock("../../../api/legacy", () => ({
  fetchOrgTree: mocks.fetchOrgTree,
  fetchExecutorStats: mocks.fetchExecutorStats,
  fetchSettings: mocks.fetchSettings,
  fetchConfig: mocks.fetchConfig,
  updateSettings: mocks.updateSettings,
}));

vi.mock("../../../hooks/useAppSettings", () => ({
  useAppSettings: () => ({
    globalPaused: mocks.appSettings.globalPaused,
    enginePaused: mocks.appSettings.enginePaused,
    toggleGlobalPause: mocks.toggleGlobalPause,
    toggleEnginePause: mocks.toggleEnginePause,
    refresh: mocks.refresh,
  }),
}));

function renderControls(projectId?: string) {
  return render(
    <CommandCenterControls
      projectId={projectId}
      colorTheme="default"
      themeMode="dark"
      onColorThemeChange={vi.fn()}
      onThemeModeChange={vi.fn()}
    />,
  );
}

function agentNode(id: string, name: string, children: OrgTreeNode[] = []): OrgTreeNode {
  return {
    agent: {
      id,
      name,
      role: "executor",
      state: "idle",
      createdAt: "2026-06-19T00:00:00.000Z",
      updatedAt: "2026-06-19T00:00:00.000Z",
      metadata: {},
    },
    children,
  };
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.appSettings.globalPaused = false;
  mocks.appSettings.enginePaused = false;
  mocks.fetchOrgTree.mockResolvedValue([]);
  mocks.fetchExecutorStats.mockResolvedValue({
    globalPause: false,
    enginePaused: false,
    maxConcurrent: 2,
    lastActivityAt: "2026-06-19T12:00:00.000Z",
  });
  mocks.fetchSettings.mockResolvedValue({ maxConcurrent: 2, maxTriageConcurrent: 1, maxWorktrees: 5 });
  mocks.fetchConfig.mockResolvedValue({ maxConcurrent: 2, rootDir: "/repo" });
  mocks.updateSettings.mockResolvedValue({});
  mocks.refresh.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("CommandCenterControls", () => {
  it("renders org chart loading, empty, and populated states", async () => {
    let resolveOrgTree: (value: OrgTreeNode[]) => void = () => {};
    mocks.fetchOrgTree.mockReturnValueOnce(new Promise<OrgTreeNode[]>((resolve) => { resolveOrgTree = resolve; }));

    const { rerender } = renderControls("project-a");
    expect(screen.getByText("Loading org chart…")).toBeDefined();

    await act(async () => resolveOrgTree([]));
    expect(screen.getByText("No agents are reporting in yet.")).toBeDefined();
    expect(mocks.fetchOrgTree).toHaveBeenCalledWith("project-a");

    mocks.fetchOrgTree.mockResolvedValueOnce([agentNode("agent-lead", "Lead Agent", [agentNode("agent-child", "Child Agent")])]);
    rerender(
      <CommandCenterControls
        projectId="project-b"
        colorTheme="default"
        themeMode="dark"
        onColorThemeChange={vi.fn()}
        onThemeModeChange={vi.fn()}
      />,
    );

    await flushPromises();
    expect(screen.getByText("Lead Agent")).toBeDefined();
    expect(screen.getByText("Child Agent")).toBeDefined();
    expect(mocks.fetchOrgTree).toHaveBeenLastCalledWith("project-b");
  });

  it("renders org chart error state without crashing", async () => {
    mocks.fetchOrgTree.mockRejectedValueOnce(new Error("fetch failed"));

    renderControls("project-a");

    await flushPromises();
    const orgSection = screen.getByTestId("cc-controls-org-chart");
    expect(within(orgSection).getByRole("alert")).toHaveTextContent("fetch failed");
  });

  it("supports undefined project ids and renders status sections", async () => {
    renderControls(undefined);

    await flushPromises();
    expect(screen.getByTestId("command-center-controls")).toBeDefined();
    expect(screen.getByTestId("cc-controls-heartbeat")).toBeDefined();
    expect(screen.getByTestId("cc-controls-engine")).toBeDefined();
    expect(screen.getByTestId("cc-controls-concurrency")).toBeDefined();
    expect(screen.getByTestId("cc-controls-theme")).toBeDefined();
    expect(mocks.fetchOrgTree).toHaveBeenCalledWith(undefined);
    expect(mocks.fetchExecutorStats).toHaveBeenCalledWith(undefined);
  });

  it("heartbeat and engine controls call the existing settings toggles", async () => {
    renderControls("project-a");

    await flushPromises();
    fireEvent.click(screen.getByRole("button", { name: /pause heartbeat/i }));
    expect(mocks.toggleEnginePause).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /stop ai engine/i }));
    expect(mocks.toggleGlobalPause).toHaveBeenCalledTimes(1);
  });

  it("disables heartbeat toggle when the AI engine is stopped", async () => {
    mocks.appSettings.globalPaused = true;
    mocks.fetchExecutorStats.mockResolvedValue({ globalPause: true, enginePaused: true, maxConcurrent: 2 });

    renderControls("project-a");

    await flushPromises();
    const heartbeatButton = screen.getByRole("button", { name: /resume heartbeat/i });
    expect(heartbeatButton).toBeDisabled();
  });

  it("persists bounded concurrency slider changes and refreshes settings", async () => {
    renderControls("project-a");

    await flushPromises();
    const section = screen.getByTestId("cc-controls-concurrency");
    const slider = within(section).getByLabelText(/max concurrent tasks/i);
    fireEvent.change(slider, { target: { value: "7" } });

    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });

    expect(mocks.updateSettings).toHaveBeenCalledWith(
      { maxConcurrent: 7, maxTriageConcurrent: 1, maxWorktrees: 5 },
      "project-a",
    );
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("persists concurrency slider changes without a project id", async () => {
    renderControls(undefined);

    await flushPromises();
    const section = screen.getByTestId("cc-controls-concurrency");
    const slider = within(section).getByLabelText(/max worktrees/i);
    fireEvent.change(slider, { target: { value: "12" } });

    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });

    expect(mocks.updateSettings).toHaveBeenCalledWith(
      { maxConcurrent: 2, maxTriageConcurrent: 1, maxWorktrees: 12 },
      undefined,
    );
  });

  it("shows save error indicator when concurrency update fails", async () => {
    mocks.updateSettings.mockRejectedValueOnce(new Error("network error"));
    renderControls("project-a");

    await flushPromises();
    const section = screen.getByTestId("cc-controls-concurrency");
    const slider = within(section).getByLabelText(/max concurrent tasks/i);
    fireEvent.change(slider, { target: { value: "8" } });

    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });

    expect(within(section).getByText(/save failed/i)).toBeDefined();
  });

  it("selects a theme from the embedded dropdown", async () => {
    const onColorThemeChange = vi.fn();
    render(
      <CommandCenterControls
        colorTheme="default"
        themeMode="dark"
        onColorThemeChange={onColorThemeChange}
        onThemeModeChange={vi.fn()}
      />,
    );

    await flushPromises();
    fireEvent.click(screen.getByRole("button", { name: /default/i }));
    fireEvent.click(screen.getAllByRole("option").find((element) => element.textContent?.trim() === "Forest")!);

    expect(onColorThemeChange).toHaveBeenCalledWith("forest");
  });
});
