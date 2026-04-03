import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MissionManager } from "../MissionManager";

// Mock data
const mockMissions = [
  {
    id: "M-001",
    title: "Build Auth System",
    description: "Complete authentication flow",
    status: "planning",
    autoAdvance: false,
    milestones: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "M-002",
    title: "API Redesign",
    description: "Redesign the REST API",
    status: "active",
    autoAdvance: true,
    milestones: [],
    createdAt: "2026-01-02T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
  },
];

const mockMissionDetail = {
  id: "M-001",
  title: "Build Auth System",
  description: "Complete authentication flow",
  status: "planning",
  autoAdvance: false,
  milestones: [
    {
      id: "MS-001",
      title: "Database Schema",
      description: "Set up auth tables",
      status: "planning",
      dependencies: [] as string[],
      slices: [
        {
          id: "SL-001",
          title: "User Tables",
          description: "Create user tables",
          status: "pending",
          features: [
            {
              id: "F-001",
              title: "User model",
              description: "Create user model",
              acceptanceCriteria: "Model exists with required fields",
              status: "defined",
              taskId: null,
              sliceId: "SL-001",
              missionId: "M-001",
            },
          ],
          milestoneId: "MS-001",
          missionId: "M-001",
        },
      ],
      missionId: "M-001",
    },
  ],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

/** Create a mock Response that matches the real api() function's expectations (text + content-type headers) */
function mockApiResponse(data: unknown) {
  return {
    ok: true,
    headers: new Headers({ "content-type": "application/json" }),
    text: () => Promise.resolve(JSON.stringify(data)),
  };
}

/** Fetch mock that returns missions list for /missions and detail for /missions/M-001 */
function createFetchMock() {
  return vi.fn().mockImplementation((_url: string) => {
    return Promise.resolve(mockApiResponse(mockMissions));
  });
}

/** Fetch mock for navigating into a mission detail */
function createDetailFetchMock() {
  let callCount = 0;
  return vi.fn().mockImplementation((_url: string) => {
    callCount++;
    // First call: list, subsequent: detail
    if (callCount === 1) {
      return Promise.resolve(mockApiResponse(mockMissions));
    }
    return Promise.resolve(mockApiResponse(mockMissionDetail));
  });
}

describe("MissionManager", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("renders nothing when isOpen is false", () => {
    globalThis.fetch = createFetchMock();
    render(<MissionManager isOpen={false} onClose={vi.fn()} addToast={vi.fn()} />);
    expect(screen.queryByTestId("mission-manager-dialog")).toBeNull();
  });

  it("renders the dialog with accessible attributes when open", async () => {
    globalThis.fetch = createFetchMock();
    render(<MissionManager isOpen={true} onClose={vi.fn()} addToast={vi.fn()} />);

    await waitFor(() => {
      const dialog = screen.getByTestId("mission-manager-dialog");
      expect(dialog).toBeDefined();
      expect(dialog.getAttribute("role")).toBe("dialog");
      expect(dialog.getAttribute("aria-modal")).toBe("true");
      expect(dialog.getAttribute("aria-label")).toBe("Mission Manager");
    });
  });

  it("renders the modal overlay with open class", async () => {
    globalThis.fetch = createFetchMock();
    render(<MissionManager isOpen={true} onClose={vi.fn()} addToast={vi.fn()} />);

    await waitFor(() => {
      const overlay = screen.getByTestId("mission-manager-overlay");
      expect(overlay).toBeDefined();
      expect(overlay.className).toContain("open");
    });
  });

  it("shows the Missions title in list view", async () => {
    globalThis.fetch = createFetchMock();
    render(<MissionManager isOpen={true} onClose={vi.fn()} addToast={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Missions")).toBeDefined();
    });
  });

  it("renders mission items in the list", async () => {
    globalThis.fetch = createFetchMock();
    render(<MissionManager isOpen={true} onClose={vi.fn()} addToast={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Build Auth System")).toBeDefined();
      expect(screen.getByText("API Redesign")).toBeDefined();
    });
  });

  it("shows mission status badges", async () => {
    globalThis.fetch = createFetchMock();
    render(<MissionManager isOpen={true} onClose={vi.fn()} addToast={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("planning")).toBeDefined();
      expect(screen.getByText("active")).toBeDefined();
    });
  });

  it("shows empty state when no missions exist", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(mockApiResponse([]));
    render(<MissionManager isOpen={true} onClose={vi.fn()} addToast={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("No missions yet. Create one to start planning.")).toBeDefined();
    });
  });

  it("calls onClose when close button is clicked", async () => {
    globalThis.fetch = createFetchMock();
    const onClose = vi.fn();
    render(<MissionManager isOpen={true} onClose={onClose} addToast={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId("mission-close-btn")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("mission-close-btn"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose when overlay background is clicked", async () => {
    globalThis.fetch = createFetchMock();
    const onClose = vi.fn();
    render(<MissionManager isOpen={true} onClose={onClose} addToast={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId("mission-manager-overlay")).toBeDefined();
    });

    const overlay = screen.getByTestId("mission-manager-overlay");
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("navigates to detail view when a mission is clicked", async () => {
    globalThis.fetch = createDetailFetchMock();
    render(<MissionManager isOpen={true} onClose={vi.fn()} addToast={vi.fn()} />);

    // Wait for list to load
    await waitFor(() => {
      expect(screen.getByText("Build Auth System")).toBeDefined();
    });

    // Click on a mission to open detail
    fireEvent.click(screen.getByText("Build Auth System"));

    // Wait for detail view to render
    await waitFor(() => {
      // Back button should appear in detail view
      expect(screen.getByTestId("mission-back-btn")).toBeDefined();
      // Milestone should be visible (auto-expanded)
      expect(screen.getByText("Database Schema")).toBeDefined();
    });
  });

  it("navigates back to list view when back button is clicked", async () => {
    // call 1: list load, call 2: detail load, call 3: re-list load after back
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 2) {
        return Promise.resolve(mockApiResponse(mockMissionDetail));
      }
      return Promise.resolve(mockApiResponse(mockMissions));
    });

    render(<MissionManager isOpen={true} onClose={vi.fn()} addToast={vi.fn()} />);

    // Navigate to detail
    await waitFor(() => {
      expect(screen.getByText("Build Auth System")).toBeDefined();
    });
    fireEvent.click(screen.getByText("Build Auth System"));

    await waitFor(() => {
      expect(screen.getByTestId("mission-back-btn")).toBeDefined();
    });

    // Click back
    fireEvent.click(screen.getByTestId("mission-back-btn"));

    // Should return to list view
    await waitFor(() => {
      expect(screen.getByText("Missions")).toBeDefined();
      expect(screen.getByText("API Redesign")).toBeDefined();
    });
  });

  it("calls onClose on Escape key press", async () => {
    globalThis.fetch = createFetchMock();
    const onClose = vi.fn();
    render(<MissionManager isOpen={true} onClose={onClose} addToast={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId("mission-manager-dialog")).toBeDefined();
    });

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("shows close button with accessible label", async () => {
    globalThis.fetch = createFetchMock();
    render(<MissionManager isOpen={true} onClose={vi.fn()} addToast={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByLabelText("Close Mission Manager")).toBeDefined();
    });
  });

  it("shows back button with accessible label in detail view", async () => {
    globalThis.fetch = createDetailFetchMock();
    render(<MissionManager isOpen={true} onClose={vi.fn()} addToast={vi.fn()} />);

    // Navigate to detail
    await waitFor(() => {
      expect(screen.getByText("Build Auth System")).toBeDefined();
    });
    fireEvent.click(screen.getByText("Build Auth System"));

    await waitFor(() => {
      expect(screen.getByLabelText("Back to missions list")).toBeDefined();
    });
  });

  it("shows New Mission button in list view", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(mockApiResponse([]));
    render(<MissionManager isOpen={true} onClose={vi.fn()} addToast={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("New Mission")).toBeDefined();
    });
  });

  it("shows milestone hierarchy in detail view", async () => {
    globalThis.fetch = createDetailFetchMock();
    render(<MissionManager isOpen={true} onClose={vi.fn()} addToast={vi.fn()} />);

    // Navigate to detail
    await waitFor(() => {
      expect(screen.getByText("Build Auth System")).toBeDefined();
    });
    fireEvent.click(screen.getByText("Build Auth System"));

    await waitFor(() => {
      // Milestone is auto-expanded, slice and feature visible
      expect(screen.getByText("Database Schema")).toBeDefined();
      expect(screen.getByText("User Tables")).toBeDefined();
      expect(screen.getByText("User model")).toBeDefined();
    });
  });
});
