import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMergeAdvanceNotice } from "../useMergeAdvanceNotice";

const mocked = vi.hoisted(() => ({ api: vi.fn(), mergedHandler: undefined as (() => void) | undefined }));

vi.mock("../../api", async () => {
  const actual = await vi.importActual<typeof import("../../api")>("../../api");
  return { ...actual, api: mocked.api };
});

vi.mock("../../sse-bus", () => ({
  subscribeSse: vi.fn((_url: string, options: { events?: Record<string, () => void> }) => {
    mocked.mergedHandler = options.events?.["task:merged"];
    return vi.fn();
  }),
}));

const eventPayload = { events: [{ taskId: "FN-1", integrationBranch: "trunk", refName: "refs/heads/trunk", toSha: "abcdef123456", fromSha: "123", advanceMode: "update-ref", succeeded: true, advancedAt: "2026", userCheckout: { worktreePath: "/repo", dirty: false, untrackedCount: 0 } }] };
const pushStatus = { integrationBranch: "trunk", branchSource: "settings" as const, hasOriginRemote: true, hasUpstream: true, localSha: "localsha", remoteSha: "remotesha", aheadCount: 2, behindCount: 0, mergeActive: false, canPush: true };

function setDefaultMocks() {
  mocked.api.mockImplementation(async (path: string) => {
    if (String(path).includes("push-status")) return pushStatus;
    if (String(path).includes("merge-advance-events")) return eventPayload;
    return { ok: true, outcome: "ok", localSha: "localsha", remoteSha: "localsha" };
  });
}

describe("useMergeAdvanceNotice", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    mocked.mergedHandler = undefined;
    window.localStorage.clear();
    window.sessionStorage.clear();
    setDefaultMocks();
  });

  it("mount fetches events and push status", async () => {
    const { result } = renderHook(() => useMergeAdvanceNotice({ projectId: "p1" }));
    await waitFor(() => expect(result.current.pushStatus?.localSha).toBe("localsha"));
  });

  it("task:merged SSE refetches push-status", async () => {
    renderHook(() => useMergeAdvanceNotice({ projectId: "p1" }));
    await waitFor(() => expect(mocked.api).toHaveBeenCalled());
    const before = mocked.api.mock.calls.length;
    act(() => mocked.mergedHandler?.());
    await waitFor(() => expect(mocked.api.mock.calls.length).toBeGreaterThan(before));
  });

  it("push posts default forceWithLease false and expected localSha", async () => {
    const { result } = renderHook(() => useMergeAdvanceNotice({ projectId: "p1" }));
    await waitFor(() => expect(result.current.pushStatus).not.toBeNull());
    await act(async () => { await result.current.push(); });
    expect(mocked.api).toHaveBeenCalledWith("/projects/p1/merge-advance/push-origin", expect.objectContaining({ body: JSON.stringify({ forceWithLease: false, expectedLocalSha: "localsha" }) }));
  });

  it("setForceWithLease persists and updates push payload", async () => {
    const { result } = renderHook(() => useMergeAdvanceNotice({ projectId: "p1" }));
    await waitFor(() => expect(result.current.pushStatus).not.toBeNull());
    act(() => result.current.setForceWithLease(true));
    expect(window.sessionStorage.getItem("kb:p1:merge-advance-force-with-lease")).toBe("1");
    await act(async () => { await result.current.push(); });
    expect(mocked.api).toHaveBeenCalledWith("/projects/p1/merge-advance/push-origin", expect.objectContaining({ body: JSON.stringify({ forceWithLease: true, expectedLocalSha: "localsha" }) }));
  });

  it("successful push auto clears pushState", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useMergeAdvanceNotice({ projectId: "p1" }));
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    await act(async () => { await result.current.push(); });
    expect(result.current.pushState).toBe("ok");
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current.pushState).toBe("idle");
  });

  it("rejected-non-ff and merge-locked outcomes do not change pullState", async () => {
    mocked.api.mockImplementationOnce(async () => eventPayload)
      .mockImplementationOnce(async () => pushStatus)
      .mockImplementationOnce(async () => ({ ok: false, outcome: "rejected-non-ff", message: "Remote diverged", stderrPreview: "[rejected]" }))
      .mockImplementationOnce(async () => eventPayload)
      .mockImplementationOnce(async () => pushStatus)
      .mockImplementationOnce(async () => ({ ok: false, outcome: "merge-locked", message: "locked" }));
    const first = renderHook(() => useMergeAdvanceNotice({ projectId: "p1" }));
    await waitFor(() => expect(first.result.current.pushStatus).not.toBeNull());
    await act(async () => { await first.result.current.push(); });
    expect(first.result.current.pushState).toMatchObject({ outcome: "rejected-non-ff" });
    expect(first.result.current.pullState).toBe("idle");

    const second = renderHook(() => useMergeAdvanceNotice({ projectId: "p1" }));
    await waitFor(() => expect(second.result.current.pushStatus).not.toBeNull());
    await act(async () => { await second.result.current.push(); });
    expect(second.result.current.pushState).toMatchObject({ outcome: "merge-locked" });
    expect(second.result.current.pullState).toBe("idle");
  });

  it("does not poll on a timer", async () => {
    vi.useFakeTimers();
    renderHook(() => useMergeAdvanceNotice({ projectId: "p1" }));
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    const initialCalls = mocked.api.mock.calls.length;
    act(() => vi.advanceTimersByTime(60_000));
    expect(mocked.api.mock.calls.length).toBe(initialCalls);
  });
});
