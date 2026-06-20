import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { LeftSidebarNav } from "../LeftSidebarNav";
import type { PluginDashboardViewEntry } from "../../api";
import type { TaskView } from "../../hooks/useViewState";

const pluginViews: PluginDashboardViewEntry[] = [
  {
    pluginId: "fusion-plugin-primary",
    view: {
      viewId: "primary-view",
      label: "Primary Plugin",
      componentPath: "./PrimaryPlugin",
      placement: "primary",
      order: 1,
    },
  },
  {
    pluginId: "fusion-plugin-overflow",
    view: {
      viewId: "overflow-view",
      label: "Overflow Plugin",
      componentPath: "./OverflowPlugin",
      placement: "overflow",
      order: 2,
    },
  },
];

function renderSidebar(overrides: Partial<ComponentProps<typeof LeftSidebarNav>> = {}) {
  const onChangeView = vi.fn();
  const props: ComponentProps<typeof LeftSidebarNav> = {
    view: "board",
    onChangeView,
    onOpenSettings: vi.fn(),
    showAgentsTab: true,
    showSkillsTab: true,
    mailboxUnreadCount: 3,
    mailboxPendingApprovalCount: 1,
    chatHasUnreadResponse: true,
    stashOrphanCount: 2,
    experimentalFeatures: {
      insights: true,
      memoryView: true,
      devServerView: true,
      researchView: true,
      evalsView: true,
      goalsView: true,
    },
    pluginDashboardViews: pluginViews,
    ...overrides,
  };

  return { ...render(<LeftSidebarNav {...props} />), onChangeView, props };
}

describe("LeftSidebarNav", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders core destinations, enabled overflow destinations, plugins, and bottom settings", () => {
    renderSidebar();

    for (const testId of [
      "sidebar-nav-board",
      "sidebar-nav-list",
      "sidebar-nav-agents",
      "sidebar-nav-command-center",
      "sidebar-nav-missions",
      "sidebar-nav-chat",
      "sidebar-nav-documents",
      "sidebar-nav-mailbox",
      "sidebar-nav-evals",
      "sidebar-nav-goals",
      "sidebar-nav-stash-recovery",
      "sidebar-nav-research",
      "sidebar-nav-insights",
      "sidebar-nav-skills",
      "sidebar-nav-memory",
      "sidebar-nav-secrets",
      "sidebar-nav-devserver",
      "sidebar-nav-plugin-fusion-plugin-primary-primary-view",
      "sidebar-nav-plugin-fusion-plugin-overflow-overflow-view",
      "sidebar-nav-settings",
    ]) {
      expect(screen.getByTestId(testId)).toBeDefined();
    }
  });

  it("gates optional destinations on their matching feature flags and props", () => {
    renderSidebar({
      showAgentsTab: false,
      showSkillsTab: false,
      experimentalFeatures: {},
      pluginDashboardViews: [],
    });

    expect(screen.getByTestId("sidebar-nav-board")).toBeDefined();
    expect(screen.getByTestId("sidebar-nav-secrets")).toBeDefined();
    expect(screen.getByTestId("sidebar-nav-stash-recovery")).toBeDefined();
    expect(screen.queryByTestId("sidebar-nav-agents")).toBeNull();
    expect(screen.queryByTestId("sidebar-nav-research")).toBeNull();
    expect(screen.queryByTestId("sidebar-nav-insights")).toBeNull();
    expect(screen.queryByTestId("sidebar-nav-skills")).toBeNull();
    expect(screen.queryByTestId("sidebar-nav-memory")).toBeNull();
    expect(screen.queryByTestId("sidebar-nav-evals")).toBeNull();
    expect(screen.queryByTestId("sidebar-nav-goals")).toBeNull();
    expect(screen.queryByTestId("sidebar-nav-devserver")).toBeNull();
    expect(screen.queryByTestId("sidebar-nav-plugin-fusion-plugin-primary-primary-view")).toBeNull();
  });

  it("renders shortened primary labels and default width", () => {
    renderSidebar();

    expect(screen.getByTestId("left-sidebar-nav")).toHaveStyle({ width: "224px", minWidth: "224px" });
    expect(screen.getByTestId("sidebar-nav-board")).toHaveAccessibleName("Board");
    expect(screen.getByTestId("sidebar-nav-list")).toHaveAccessibleName("List");
    expect(screen.getByTestId("sidebar-nav-agents")).toHaveAccessibleName("Agents");
    expect(screen.getByTestId("sidebar-nav-missions")).toHaveAccessibleName("Missions");
    expect(screen.queryByRole("button", { name: /view$/i })).toBeNull();
  });

  it("renders mailbox and stash badges", () => {
    renderSidebar();

    const mailboxBadge = screen.getByTestId("sidebar-nav-mailbox").querySelector(".left-sidebar-nav__badge");
    const stashBadge = screen.getByTestId("sidebar-nav-stash-recovery").querySelector(".left-sidebar-nav__badge");

    expect(mailboxBadge?.textContent).toBe("3");
    expect(stashBadge?.textContent).toBe("2");
  });

  it("renders zero plugin views and at least one primary and overflow plugin view", () => {
    const empty = renderSidebar({ pluginDashboardViews: [] });
    expect(screen.queryByTestId("sidebar-nav-plugin-fusion-plugin-primary-primary-view")).toBeNull();
    empty.unmount();

    renderSidebar({ pluginDashboardViews: pluginViews });
    expect(screen.getByTestId("sidebar-nav-plugin-fusion-plugin-primary-primary-view")).toBeDefined();
    expect(screen.getByTestId("sidebar-nav-plugin-fusion-plugin-overflow-overflow-view")).toBeDefined();
  });

  it("renders plugin labels without view suffix and shortens Compound Engineering", () => {
    renderSidebar({
      pluginDashboardViews: [
        ...pluginViews,
        {
          pluginId: "fusion-plugin-compound-engineering",
          view: {
            viewId: "compound",
            label: "Compound Engineering",
            componentPath: "./CompoundEngineering",
            placement: "primary",
            order: 0,
          },
        },
      ],
    });

    const primaryPlugin = screen.getByTestId("sidebar-nav-plugin-fusion-plugin-primary-primary-view");
    const compoundPlugin = screen.getByTestId("sidebar-nav-plugin-fusion-plugin-compound-engineering-compound");
    expect(primaryPlugin).toHaveAccessibleName("Primary Plugin");
    expect(primaryPlugin).toHaveAttribute("title", "Primary Plugin");
    expect(primaryPlugin).toHaveTextContent("Primary Plugin");
    expect(primaryPlugin).not.toHaveTextContent("view");
    expect(compoundPlugin).toHaveAccessibleName("Compound");
    expect(compoundPlugin).toHaveAttribute("title", "Compound");
    expect(compoundPlugin).toHaveTextContent("Compound");
    expect(compoundPlugin).not.toHaveTextContent("Compound Engineering");
  });

  it.each<[TaskView, string]>([
    ["board", "sidebar-nav-board"],
    ["research", "sidebar-nav-research"],
    ["plugin:fusion-plugin-primary:primary-view", "sidebar-nav-plugin-fusion-plugin-primary-primary-view"],
    ["plugin:fusion-plugin-overflow:overflow-view", "sidebar-nav-plugin-fusion-plugin-overflow-overflow-view"],
  ])("highlights active destination %s", (view, testId) => {
    renderSidebar({ view });
    expect(screen.getByTestId(testId).getAttribute("aria-current")).toBe("page");
  });

  it("toggles collapsed rail mode and restores it on remount", () => {
    const firstRender = renderSidebar();
    const sidebar = screen.getByTestId("left-sidebar-nav");

    fireEvent.click(screen.getByTestId("sidebar-nav-collapse-toggle"));
    expect(sidebar.className).toContain("left-sidebar-nav--collapsed");
    expect(window.localStorage.getItem("fusion:left-sidebar-collapsed")).toBe("true");
    expect(screen.queryByTestId("sidebar-nav-resize-handle")).toBeNull();

    firstRender.unmount();
    renderSidebar();
    expect(screen.getByTestId("left-sidebar-nav").className).toContain("left-sidebar-nav--collapsed");
  });

  it("clamps and persists drag resize width", () => {
    renderSidebar();
    const sidebar = screen.getByTestId("left-sidebar-nav");
    const handle = screen.getByTestId("sidebar-nav-resize-handle");

    fireEvent.pointerDown(handle, { clientX: 0, pointerId: 1 });
    fireEvent.pointerMove(document, { clientX: 999 });
    fireEvent.pointerUp(document, { clientX: 999, pointerId: 1 });

    expect(sidebar).toHaveStyle({ width: "384px", minWidth: "384px" });
    expect(window.localStorage.getItem("fusion:left-sidebar-width")).toBe("384");
  });

  it("restores persisted width and keyboard-resizes within clamps", () => {
    window.localStorage.setItem("fusion:left-sidebar-width", "999");
    renderSidebar();

    const sidebar = screen.getByTestId("left-sidebar-nav");
    const handle = screen.getByTestId("sidebar-nav-resize-handle");
    expect(sidebar).toHaveStyle({ width: "384px", minWidth: "384px" });

    fireEvent.keyDown(handle, { key: "ArrowLeft", shiftKey: true });
    expect(sidebar).toHaveStyle({ width: "336px", minWidth: "336px" });
    expect(window.localStorage.getItem("fusion:left-sidebar-width")).toBe("336");
  });

  it("routes clicks to view changes, todos callback, and settings callback", () => {
    const onOpenTodos = vi.fn();
    const onOpenSettings = vi.fn();
    const { onChangeView } = renderSidebar({ todosEnabled: true, onOpenTodos, onOpenSettings });

    fireEvent.click(screen.getByTestId("sidebar-nav-list"));
    expect(onChangeView).toHaveBeenCalledWith("list");

    fireEvent.click(screen.getByTestId("sidebar-nav-plugin-fusion-plugin-overflow-overflow-view"));
    expect(onChangeView).toHaveBeenCalledWith("plugin:fusion-plugin-overflow:overflow-view");

    fireEvent.click(screen.getByTestId("sidebar-nav-todos"));
    expect(onOpenTodos).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByTestId("sidebar-nav-settings"));
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });
});
