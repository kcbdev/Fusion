import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlanningModeModal } from "../PlanningModeModal";
import { NavigationHistoryProvider, useNavigationHistory } from "../../hooks/useNavigationHistory";

const mockViewportMode = vi.fn<() => "mobile" | "desktop">();
const mockFetchAiSessions = vi.fn();
const mockFetchAiSession = vi.fn();
const mockFetchModels = vi.fn();
const mockSubscribeSse = vi.fn(() => vi.fn());

vi.mock("../../hooks/useViewportMode", () => ({
  useViewportMode: () => mockViewportMode(),
}));

vi.mock("../../hooks/useSessionLock", () => ({
  useSessionLock: () => ({
    isLockedByOther: false,
    takeControl: vi.fn(),
    isLoading: false,
  }),
}));

vi.mock("../../hooks/useAiSessionSync", () => ({
  useAiSessionSync: () => ({
    activeTabMap: new Map(),
    broadcastUpdate: vi.fn(),
    broadcastCompleted: vi.fn(),
    broadcastLock: vi.fn(),
    broadcastUnlock: vi.fn(),
    broadcastHeartbeat: vi.fn(),
  }),
}));

vi.mock("../../utils/getSessionTabId", () => ({
  getSessionTabId: () => "tab-1",
}));

vi.mock("../../sse-bus", () => ({
  subscribeSse: (...args: unknown[]) => mockSubscribeSse(...args),
}));

vi.mock("../../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api")>();
  return {
    ...actual,
    fetchAiSessions: (...args: unknown[]) => mockFetchAiSessions(...args),
    fetchAiSession: (...args: unknown[]) => mockFetchAiSession(...args),
    fetchModels: (...args: unknown[]) => mockFetchModels(...args),
    parseConversationHistory: () => [],
    updateGlobalSettings: vi.fn().mockResolvedValue(undefined),
  };
});

const planningSessionSummary = {
  id: "plan-1",
  type: "planning" as const,
  title: "Roadmap draft",
  preview: "Plan authentication",
  status: "draft" as const,
  archived: false,
  createdAt: "2026-05-01T00:00:00.000Z",
  updatedAt: "2026-05-01T00:00:00.000Z",
  projectId: null,
};

const planningSessionDetail = {
  ...planningSessionSummary,
  inputPayload: JSON.stringify({ initialPlan: "Plan authentication" }),
  conversationHistory: "[]",
  thinkingOutput: "",
  currentQuestion: null,
  result: null,
  error: null,
};

function HistoryHarness({ children }: { children: ReactNode }) {
  const history = useNavigationHistory({ enabled: true });
  return <NavigationHistoryProvider value={history}>{children}</NavigationHistoryProvider>;
}

describe("PlanningModeModal mobile swipe-back", () => {
  const originalPushState = window.history.pushState;

  beforeEach(() => {
    vi.clearAllMocks();
    mockViewportMode.mockReturnValue("mobile");
    mockFetchAiSessions.mockResolvedValue([planningSessionSummary]);
    mockFetchAiSession.mockResolvedValue(planningSessionDetail);
    mockFetchModels.mockResolvedValue({ models: [], favoriteProviders: [], favoriteModels: [] });
    window.history.pushState = vi.fn();
  });

  afterEach(() => {
    window.history.pushState = originalPushState;
  });

  it("pushes a mobile nav entry when opening a planning session and popstate returns to the list", async () => {
    render(
      <HistoryHarness>
        <PlanningModeModal
          isOpen={true}
          onClose={vi.fn()}
          onTaskCreated={vi.fn()}
          onTasksCreated={vi.fn()}
          tasks={[]}
        />
      </HistoryHarness>,
    );

    await waitFor(() => {
      expect(screen.getByText("Roadmap draft")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Roadmap draft"));

    await waitFor(() => {
      expect(mockFetchAiSession).toHaveBeenCalledWith("plan-1");
      expect(window.history.pushState).toHaveBeenCalledWith(expect.objectContaining({ navIndex: 1 }), "");
    });

    expect(screen.getByLabelText("Back to sessions")).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: { navIndex: 0 } }));
    });

    await waitFor(() => {
      expect(screen.queryByLabelText("Back to sessions")).not.toBeInTheDocument();
    });
  });

  it("pushes a mobile nav entry when opening the new-session detail and popstate returns to the list", async () => {
    render(
      <HistoryHarness>
        <PlanningModeModal
          isOpen={true}
          onClose={vi.fn()}
          onTaskCreated={vi.fn()}
          onTasksCreated={vi.fn()}
          tasks={[]}
        />
      </HistoryHarness>,
    );

    await waitFor(() => {
      expect(screen.getByText("Roadmap draft")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /new session/i }));

    await waitFor(() => {
      expect(window.history.pushState).toHaveBeenCalledWith(expect.objectContaining({ navIndex: 1 }), "");
    });

    expect(screen.getByLabelText("Back to sessions")).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: { navIndex: 0 } }));
    });

    await waitFor(() => {
      expect(screen.queryByLabelText("Back to sessions")).not.toBeInTheDocument();
    });
  });

  it("does not push a nav entry on desktop session selection", async () => {
    mockViewportMode.mockReturnValue("desktop");

    render(
      <HistoryHarness>
        <PlanningModeModal
          isOpen={true}
          onClose={vi.fn()}
          onTaskCreated={vi.fn()}
          onTasksCreated={vi.fn()}
          tasks={[]}
        />
      </HistoryHarness>,
    );

    await waitFor(() => {
      expect(screen.getByText("Roadmap draft")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Roadmap draft"));

    await waitFor(() => {
      expect(mockFetchAiSession).toHaveBeenCalledWith("plan-1");
    });
    expect(window.history.pushState).not.toHaveBeenCalled();
  });
});
