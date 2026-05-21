import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MergeAdvanceNotice from "../MergeAdvanceNotice";
import { ApiRequestError } from "../../api";

const mocked = vi.hoisted(() => ({
  api: vi.fn(),
  mergedHandler: undefined as (() => void) | undefined,
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

function makeEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    taskId: "FN-1",
    integrationBranch: "master",
    refName: "refs/heads/master",
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
    expect(await screen.findByText(/master advanced to abcdef1\./)).toBeInTheDocument();
    expect(screen.getByText(/Your checked-out copy at \/repo is behind\./)).toBeInTheDocument();
  });

  it.each([
    { dirty: true, untrackedCount: 0 },
    { dirty: false, untrackedCount: 2 },
  ])("shows local changes preserved and hides pull when dirty markers present", async ({ dirty, untrackedCount }) => {
    mocked.api.mockResolvedValueOnce({ events: [makeEvent({ userCheckout: { worktreePath: "/repo", dirty, untrackedCount } })] });
    render(<MergeAdvanceNotice projectId="proj-1" />);
    expect(await screen.findByText(/local changes preserved/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pull" })).toBeNull();
  });

  it("pull posts rebase false and dismisses on success", async () => {
    mocked.api
      .mockResolvedValueOnce({ events: [makeEvent()] })
      .mockResolvedValueOnce({ ok: true });
    render(<MergeAdvanceNotice projectId="proj-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Pull" }));

    await waitFor(() => expect(mocked.api).toHaveBeenNthCalledWith(2, "/git/pull?projectId=proj-1", {
      method: "POST",
      body: JSON.stringify({ rebase: false }),
    }));
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });

  it("shows inline pull failure and keeps notice visible", async () => {
    mocked.api
      .mockResolvedValueOnce({ events: [makeEvent()] })
      .mockRejectedValueOnce(new ApiRequestError("Merge conflict detected", 409));
    render(<MergeAdvanceNotice projectId="proj-1" />);

    const pullButton = await screen.findByRole("button", { name: "Pull" });
    fireEvent.click(pullButton);

    expect(await screen.findByText(/Merge conflict detected/)).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pull" })).not.toBeDisabled();
  });

  it("dismisses current sha and stays hidden when same advance is refetched", async () => {
    mocked.api
      .mockResolvedValueOnce({ events: [makeEvent()] })
      .mockResolvedValueOnce({ events: [makeEvent()] });
    render(<MergeAdvanceNotice projectId="proj-1" />);

    fireEvent.click(await screen.findByRole("button", { name: /dismiss merge advance notice/i }));
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());

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
    expect(await screen.findByText(/master advanced to bbbbbbb\./)).toBeInTheDocument();
  });

  it("renders nothing for failed advance or null checkout", async () => {
    mocked.api.mockResolvedValueOnce({ events: [makeEvent({ succeeded: false }), makeEvent({ userCheckout: null })] });
    const { container } = render(<MergeAdvanceNotice projectId="proj-1" />);
    await waitFor(() => expect(mocked.api).toHaveBeenCalledTimes(1));
    expect(container.firstChild).toBeNull();
  });
});
