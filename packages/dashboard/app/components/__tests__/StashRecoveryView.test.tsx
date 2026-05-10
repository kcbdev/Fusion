import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StashRecoveryView } from "../StashRecoveryView";

const apiMock = vi.fn();
const confirmMock = vi.fn();

vi.mock("../../api", () => ({ api: (...args: unknown[]) => apiMock(...args) }));
vi.mock("../../hooks/useConfirm", () => ({ useConfirm: () => ({ confirm: confirmMock }) }));

describe("StashRecoveryView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders empty state", async () => {
    apiMock.mockResolvedValueOnce({ records: [] });
    render(<StashRecoveryView />);
    expect(await screen.findByText(/No orphaned merger autostashes found/i)).toBeInTheDocument();
  });

  it("renders grouped rows and apply", async () => {
    apiMock.mockResolvedValueOnce({ records: [{ sha: "abcdef123", sourceTaskId: "FN-1", createdAt: null, classification: "live", changedPaths: ["a"] }] });
    apiMock.mockResolvedValueOnce({ ok: false, reason: "conflict", stderr: "conflict text" });
    render(<StashRecoveryView />);
    expect(await screen.findByText("FN-1")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Apply"));
    await waitFor(() => expect(screen.getByText(/conflict text/i)).toBeInTheDocument());
  });

  it("opens inspect diff modal", async () => {
    apiMock.mockResolvedValueOnce({ records: [{ sha: "abcdef123", sourceTaskId: "FN-1", createdAt: null, classification: "live", changedPaths: ["a"] }] });
    apiMock.mockResolvedValueOnce({ diff: "patch-content", truncated: false });
    render(<StashRecoveryView />);
    await screen.findByText("FN-1");
    fireEvent.click(screen.getByText("Inspect diff"));
    expect(await screen.findByText(/Diff for abcdef1/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("patch-content")).toBeInTheDocument());
  });

  it("drop requires confirmation", async () => {
    apiMock.mockResolvedValueOnce({ records: [{ sha: "abcdef123", sourceTaskId: null, createdAt: null, classification: "live", changedPaths: [] }] });
    confirmMock.mockResolvedValueOnce(false);
    render(<StashRecoveryView />);
    await screen.findByText("Unknown source");
    fireEvent.click(screen.getByText("Drop"));
    await waitFor(() => expect(confirmMock).toHaveBeenCalled());
    expect(apiMock).toHaveBeenCalledTimes(1);
  });
});
