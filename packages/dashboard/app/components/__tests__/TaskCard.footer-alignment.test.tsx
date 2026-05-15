import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { render } from "@testing-library/react";
import type { Task } from "@fusion/core";
import { TaskCard } from "../TaskCard";
import { loadAllAppCss } from "../../test/cssFixture";

vi.mock("lucide-react", () => ({
  Link: () => <svg />,
  GitBranch: () => <svg />,
  Clock: () => <svg />,
  Pencil: () => <svg />,
  Layers: () => <svg />,
  ChevronDown: () => <svg />,
  Folder: () => <svg />,
  GitPullRequest: () => <svg />,
  CircleDot: () => <svg />,
  Target: () => <svg />,
  Bot: () => <svg />,
  Trash2: () => <svg />,
  RotateCw: () => <svg />,
  Zap: () => <svg />,
}));

vi.mock("../../hooks/useTaskDiffStats", () => ({
  useTaskDiffStats: () => ({ stats: null, loading: false }),
}));

vi.mock("../../hooks/useBadgeWebSocket", () => ({
  useBadgeWebSocket: () => ({
    badgeUpdates: new Map(),
    isConnected: true,
    subscribeToBadge: vi.fn(),
    unsubscribeFromBadge: vi.fn(),
  }),
}));

vi.mock("../../hooks/useBatchBadgeFetch", () => ({
  getFreshBatchData: vi.fn(() => null),
}));

vi.mock("../../api", () => ({
  fetchTaskDetail: vi.fn(),
  uploadAttachment: vi.fn(),
  fetchMission: vi.fn(),
  fetchAgent: vi.fn(),
}));

vi.mock("../../hooks/useConfirm", () => ({
  useConfirm: () => ({ confirm: vi.fn(async () => true) }),
}));

const noop = () => {};

function makeTask(): Task {
  return {
    id: "FN-4598",
    title: "Alignment test",
    description: "",
    column: "in-progress",
    steps: [],
    dependencies: [],
    sourceType: "github_import",
    issueInfo: {
      owner: "runfusion",
      repo: "fusion",
      number: 315,
      title: "Imported issue",
      url: "https://github.com/runfusion/fusion/issues/315",
    },
    githubTracking: {
      enabled: true,
      issue: {
        owner: "runfusion",
        repo: "fusion",
        number: 316,
        url: "https://github.com/runfusion/fusion/issues/316",
        createdAt: new Date().toISOString(),
      },
    },
    retrySummary: { total: 2 },
    columnMovedAt: new Date(Date.now() - 60_000).toISOString(),
  } as Task;
}

describe("FN-4598 TaskCard footer chip alignment", () => {
  let styleEl: HTMLStyleElement;

  beforeAll(() => {
    styleEl = document.createElement("style");
    styleEl.textContent = loadAllAppCss();
    document.head.appendChild(styleEl);
  });

  afterAll(() => {
    styleEl.remove();
  });

  it("keeps footer chips and inner spans vertically centered", () => {
    const { container } = render(
      <TaskCard task={makeTask()} onOpenDetail={noop} addToast={noop} onOpenDetailWithTab={noop} />,
    );

    const selectors = [
      ".card-retry-badge",
      ".card-time-indicator",
      ".card-github-tracking-chip",
    ] as const;

    for (const selector of selectors) {
      const chip = container.querySelector(selector) as HTMLElement;
      expect(chip).toBeTruthy();
      const chipStyle = getComputedStyle(chip);
      expect(chipStyle.display).toBe("inline-flex");
      expect(chipStyle.alignItems).toBe("center");
      expect(chipStyle.lineHeight).toBe("1");

      const textSpan = chip.querySelector("span") as HTMLElement;
      expect(textSpan).toBeTruthy();
      const textStyle = getComputedStyle(textSpan);
      expect(textStyle.display).toBe("inline-flex");
      expect(textStyle.alignItems).toBe("center");
      expect(textStyle.lineHeight).toBe("1");
      expect(textStyle.transform).toMatch(/translateY\(1px\)|matrix\(1,\s*0,\s*0,\s*1,\s*0,\s*1\)/);
    }
  });
});
