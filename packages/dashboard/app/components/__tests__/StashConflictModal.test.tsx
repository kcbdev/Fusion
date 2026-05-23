import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import StashConflictModal from "../StashConflictModal";
import { ApiRequestError } from "../../api";

const mocked = vi.hoisted(() => ({
  api: vi.fn(),
  openFile: vi.fn(),
  writeText: vi.fn(),
}));

vi.mock("../../api", async () => {
  const actual = await vi.importActual<typeof import("../../api")>("../../api");
  return {
    ...actual,
    api: mocked.api,
  };
});

vi.mock("../../context/FileBrowserContext", () => ({
  useFileBrowser: () => ({ openFile: mocked.openFile }),
}));

function renderModal(overrides: Partial<ComponentProps<typeof StashConflictModal>> = {}) {
  return render(
    <StashConflictModal
      open
      onClose={vi.fn()}
      worktreePath="/repo"
      integrationBranch="release"
      stashSha="1234567890abcdef"
      stashLabel="fusion-auto-stash-FN-1"
      conflictedFiles={["src/a.ts", "src/b.ts"]}
      taskId="FN-1"
      {...overrides}
    />,
  );
}

describe("StashConflictModal", () => {
  beforeEach(() => {
    mocked.api.mockReset();
    mocked.openFile.mockReset();
    mocked.writeText.mockReset();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: mocked.writeText },
      configurable: true,
    });
  });

  it("does not render when closed", () => {
    renderModal({ open: false });
    expect(screen.queryByText(/Resolve auto-stash conflicts/)).toBeNull();
  });

  it("renders one row per conflicted file with actions", () => {
    renderModal();
    expect(screen.getByText("src/a.ts")).toBeInTheDocument();
    expect(screen.getByText("src/b.ts")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Keep mine" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Keep incoming" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Open in editor" })).toHaveLength(2);
  });

  it("Keep mine posts ours and removes row from response", async () => {
    mocked.api.mockResolvedValueOnce({ remainingConflicts: ["src/b.ts"] });
    renderModal();

    fireEvent.click(screen.getAllByRole("button", { name: "Keep mine" })[0]);

    await waitFor(() => expect(mocked.api).toHaveBeenCalledWith("/git/stash-resolve", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ worktreePath: "/repo", stashSha: "1234567890abcdef", file: "src/a.ts", choice: "ours", taskId: "FN-1" }),
    })));
    expect(screen.queryByText("src/a.ts")).toBeNull();
    expect(screen.getByText("src/b.ts")).toBeInTheDocument();
  });

  it("Keep incoming posts theirs", async () => {
    mocked.api.mockResolvedValueOnce({ remainingConflicts: ["src/a.ts"] });
    renderModal();

    fireEvent.click(screen.getAllByRole("button", { name: "Keep incoming" })[1]);

    await waitFor(() => expect(mocked.api).toHaveBeenCalledWith("/git/stash-resolve", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ worktreePath: "/repo", stashSha: "1234567890abcdef", file: "src/b.ts", choice: "theirs", taskId: "FN-1" }),
    })));
  });

  it("Open in editor uses file browser workspace", () => {
    renderModal();
    fireEvent.click(screen.getAllByRole("button", { name: "Open in editor" })[0]);
    expect(mocked.openFile).toHaveBeenCalledWith("src/a.ts", { workspace: "/repo" });
  });

  it("Drop stash disabled until conflicts resolved, then drops and closes", async () => {
    const onClose = vi.fn();
    mocked.api
      .mockResolvedValueOnce({ remainingConflicts: [] })
      .mockResolvedValueOnce({ dropped: true });
    renderModal({ onClose });

    const drop = screen.getByRole("button", { name: "Drop stash" });
    expect(drop).toBeDisabled();

    fireEvent.click(screen.getAllByRole("button", { name: "Keep mine" })[0]);
    await waitFor(() => expect(drop).toBeEnabled());

    fireEvent.click(drop);
    await waitFor(() => expect(mocked.api).toHaveBeenCalledWith("/git/stash-drop", expect.objectContaining({ method: "POST" })));
    expect(onClose).toHaveBeenCalled();
  });

  it("Restore from stash ref posts and updates conflicts when returned", async () => {
    mocked.api.mockResolvedValueOnce({ applied: true, conflict: true, conflictedFiles: ["src/c.ts"] });
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: "Restore from stash ref" }));

    await waitFor(() => expect(mocked.api).toHaveBeenCalledWith("/git/stash-restore", expect.objectContaining({ method: "POST" })));
    expect(screen.getByText("src/c.ts")).toBeInTheDocument();
  });

  it("shows inline error for resolve/drop/restore failures", async () => {
    mocked.api
      .mockRejectedValueOnce(new ApiRequestError("resolve failed", 500))
      .mockRejectedValueOnce(new ApiRequestError("restore failed", 500))
      .mockResolvedValueOnce({ remainingConflicts: [] })
      .mockRejectedValueOnce(new ApiRequestError("drop failed", 500));
    renderModal();

    fireEvent.click(screen.getAllByRole("button", { name: "Keep mine" })[0]);
    expect(await screen.findByText("resolve failed")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Restore from stash ref" }));
    expect(await screen.findByText("restore failed")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Keep mine" })[0]);
    await waitFor(() => expect(screen.getByRole("button", { name: "Drop stash" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Drop stash" }));
    const dropError = await screen.findByText("drop failed");
    expect(dropError).toHaveAttribute("role", "alert");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("shows stash sha/label and copies sha", async () => {
    mocked.writeText.mockResolvedValueOnce(undefined);
    renderModal();

    expect(screen.getByText(/Stash ref: 1234567 \(fusion-auto-stash-FN-1\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy stash reference" }));

    await waitFor(() => expect(mocked.writeText).toHaveBeenCalledWith("1234567890abcdef"));
    expect(screen.getByText("Stash SHA copied.")).toHaveAttribute("role", "status");
  });

  it("supports Escape close, initial focus, focus return, and tab wrapping", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const trigger = document.createElement("button");
    trigger.textContent = "open modal";
    document.body.appendChild(trigger);
    trigger.focus();

    const view = render(
      <StashConflictModal
        open
        onClose={onClose}
        worktreePath="/repo"
        integrationBranch="release"
        stashSha="1234567890abcdef"
        stashLabel="fusion-auto-stash-FN-1"
        conflictedFiles={["src/a.ts", "src/b.ts"]}
        taskId="FN-1"
      />,
    );

    const dialog = screen.getByRole("dialog");
    const title = screen.getByRole("heading", { name: "Resolve auto-stash conflicts" });
    expect(dialog).toHaveAttribute("aria-labelledby", "stash-conflict-modal-title");
    expect(title).toHaveAttribute("id", "stash-conflict-modal-title");

    const copyButton = screen.getByRole("button", { name: "Copy stash reference" });
    expect(document.activeElement).toBe(copyButton);

    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => !element.hasAttribute("disabled") && element.getAttribute("aria-hidden") !== "true");
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    first.focus();
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(document.activeElement).toBe(last);

    last.focus();
    await user.keyboard("{Tab}");
    expect(document.activeElement).toBe(first);

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);

    view.unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});
