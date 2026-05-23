import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MergeAdvanceNotice from "../MergeAdvanceNotice";
import { ApiRequestError } from "../../api";

const mocked = vi.hoisted(() => ({
  api: vi.fn(),
  mergedHandler: undefined as (() => void) | undefined,
  stashModalProps: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../api", async () => {
  const actual = await vi.importActual<typeof import("../../api")>("../../api");
  return {
    ...actual,
    api: mocked.api,
  };
});

vi.mock("../../sse-bus", () => ({
  subscribeSse: vi.fn((_url: string, options: { events?: Record<string, () => void> }) => {
    mocked.mergedHandler = options.events?.["task:merged"];
    return vi.fn();
  }),
}));

vi.mock("../StashConflictModal", () => ({
  default: (props: Record<string, unknown>) => {
    mocked.stashModalProps.push(props);
    return props.open ? <div data-testid="stash-conflict-modal">stash-conflict-modal</div> : null;
  },
}));

function makeEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    taskId: "FN-1",
    integrationBranch: "release",
    refName: "refs/heads/release",
    toSha: "abcdef123456",
    fromSha: "1234567",
    advanceMode: "update-ref",
    succeeded: true,
    advancedAt: "2026-05-21T12:00:00.000Z",
    userCheckout: {
      worktreePath: "/repo",
      dirty: false,
      untrackedCount: 0,
    },
    ...overrides,
  };
}

describe("MergeAdvanceNotice", () => {
  beforeEach(() => {
    mocked.api.mockReset();
    mocked.mergedHandler = undefined;
    mocked.stashModalProps = [];
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when api returns no events", async () => {
    mocked.api.mockResolvedValueOnce({ events: [] });
    const { container } = render(<MergeAdvanceNotice projectId="proj-1" />);
    await waitFor(() => expect(mocked.api).toHaveBeenCalledTimes(1));
    expect(container.firstChild).toBeNull();
  });

  it("renders notice with dynamic branch name", async () => {
    mocked.api.mockResolvedValueOnce({ events: [makeEvent()] });
    render(<MergeAdvanceNotice projectId="proj-1" />);
    expect(await screen.findByText(/release advanced to abcdef1\./)).toBeInTheDocument();
    expect(screen.getByText(/Your checked-out copy at \/repo is behind\./)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByRole("button", { name: "Dismiss merge advance notice" })).toBeInTheDocument();
  });

  it.each([
    { dirty: true, untrackedCount: 0 },
    { dirty: false, untrackedCount: 2 },
  ])("shows auto-stash copy and keeps pull visible for dirty state", async ({ dirty, untrackedCount }) => {
    mocked.api
      .mockResolvedValueOnce({ events: [makeEvent({ userCheckout: { worktreePath: "/repo", dirty, untrackedCount } })] })
      .mockResolvedValueOnce({ kind: "clean-pull", toSha: "abcdef123456" });
    render(<MergeAdvanceNotice projectId="proj-1" />);

    expect(await screen.findByText(/local changes will be auto-stashed and restored/)).toBeInTheDocument();
    const pullButton = screen.getByRole("button", { name: "Pull" });
    fireEvent.click(pullButton);

    await waitFor(() => expect(mocked.api).toHaveBeenNthCalledWith(2, "/git/smart-pull?projectId=proj-1", {
      method: "POST",
      body: JSON.stringify({
        worktreePath: "/repo",
        integrationBranch: "release",
        taskId: "FN-1",
      }),
    }));
  });

  it("clean smart-pull dismisses notice", async () => {
    mocked.api
      .mockResolvedValueOnce({ events: [makeEvent()] })
      .mockResolvedValueOnce({ kind: "clean-pull", toSha: "abcdef123456" });
    render(<MergeAdvanceNotice projectId="proj-1" />);

    fireEvent.click(await screen.findByRole("button", { name: "Pull" }));
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });

  it("dirty smart-pull stash-pull-pop dismisses notice", async () => {
    mocked.api
      .mockResolvedValueOnce({ events: [makeEvent({ userCheckout: { worktreePath: "/repo", dirty: true, untrackedCount: 0 } })] })
      .mockResolvedValueOnce({ kind: "stash-pull-pop", toSha: "abcdef123456" });
    render(<MergeAdvanceNotice projectId="proj-1" />);

    fireEvent.click(await screen.findByRole("button", { name: "Pull" }));
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });

  it("stash-pop-conflict opens modal and passes payload", async () => {
    mocked.api
      .mockResolvedValueOnce({ events: [makeEvent({ userCheckout: { worktreePath: "/repo", dirty: true, untrackedCount: 1 } })] })
      .mockResolvedValueOnce({
        kind: "stash-pop-conflict",
        toSha: "abcdef123456",
        stashSha: "stashsha123",
        stashLabel: "fusion-auto-stash-FN-1",
        conflictedFiles: ["src/a.ts"],
      });
    render(<MergeAdvanceNotice projectId="proj-1" />);

    fireEvent.click(await screen.findByRole("button", { name: "Pull" }));

    expect(await screen.findByTestId("stash-conflict-modal")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pull" })).toBeNull();

    const props = mocked.stashModalProps.at(-1);
    expect(props).toMatchObject({
      open: true,
      worktreePath: "/repo",
      integrationBranch: "release",
      stashSha: "stashsha123",
      stashLabel: "fusion-auto-stash-FN-1",
      conflictedFiles: ["src/a.ts"],
      taskId: "FN-1",
    });
  });

  it("shows inline pull failure and keeps notice visible", async () => {
    mocked.api
      .mockResolvedValueOnce({ events: [makeEvent()] })
      .mockRejectedValueOnce(new ApiRequestError("Merge conflict detected", 409));
    render(<MergeAdvanceNotice projectId="proj-1" />);

    const pullButton = await screen.findByRole("button", { name: "Pull" });
    fireEvent.click(pullButton);

    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent("Merge conflict detected");
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("dismisses current sha and stays hidden when same advance is refetched", async () => {
    mocked.api
      .mockResolvedValueOnce({ events: [makeEvent()] })
      .mockResolvedValueOnce({ events: [makeEvent()] });
    render(<MergeAdvanceNotice projectId="proj-1" />);

    const dismissButton = await screen.findByRole("button", { name: /dismiss merge advance notice/i });
    dismissButton.focus();
    fireEvent.click(dismissButton);

    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(document.activeElement).toBe(document.body);

    mocked.mergedHandler?.();
    await waitFor(() => expect(mocked.api).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows fresh advance after previous sha dismissed", async () => {
    mocked.api
      .mockResolvedValueOnce({ events: [makeEvent({ toSha: "aaaaaaa111" })] })
      .mockResolvedValueOnce({ events: [makeEvent({ toSha: "bbbbbbb222" })] });
    render(<MergeAdvanceNotice projectId="proj-1" />);

    fireEvent.click(await screen.findByRole("button", { name: /dismiss merge advance notice/i }));
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());

    mocked.mergedHandler?.();
    expect(await screen.findByText(/release advanced to bbbbbbb\./)).toBeInTheDocument();
  });

  it("renders nothing for failed advance or null checkout", async () => {
    mocked.api.mockResolvedValueOnce({ events: [makeEvent({ succeeded: false }), makeEvent({ userCheckout: null })] });
    const { container } = render(<MergeAdvanceNotice projectId="proj-1" />);
    await waitFor(() => expect(mocked.api).toHaveBeenCalledTimes(1));
    expect(container.firstChild).toBeNull();
  });
});
