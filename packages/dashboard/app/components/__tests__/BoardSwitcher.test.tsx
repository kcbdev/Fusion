import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BoardSwitcher } from "../BoardSwitcher";
import type { BoardSummary } from "../../api";

function board(id: string, name: string, ordering: number): BoardSummary {
  return { id, name, description: "", requirePlanApproval: false, lfgMode: false, ordering };
}

const TWO_BOARDS = [board("b2", "Beta", 1), board("b1", "Alpha", 0)];

describe("BoardSwitcher (U10)", () => {
  it("renders a loading skeleton while the index loads with no data", () => {
    render(<BoardSwitcher boards={[]} selectedBoardId={null} onSelect={() => {}} loading />);
    expect(screen.getByTestId("board-switcher-skeleton")).toBeDefined();
  });

  it("renders boards ordered by `ordering` regardless of input order", () => {
    render(<BoardSwitcher boards={TWO_BOARDS} selectedBoardId="b1" onSelect={() => {}} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Alpha", "Beta"]);
  });

  it("highlights the active board", () => {
    render(<BoardSwitcher boards={TWO_BOARDS} selectedBoardId="b2" onSelect={() => {}} />);
    expect(screen.getByTestId("board-switcher-tab-b2").getAttribute("data-active")).toBe("true");
    expect(screen.getByTestId("board-switcher-tab-b1").getAttribute("data-active")).toBe("false");
    expect(screen.getByTestId("board-switcher-tab-b2").getAttribute("aria-selected")).toBe("true");
  });

  it("invokes onSelect with the clicked board id", () => {
    const onSelect = vi.fn();
    render(<BoardSwitcher boards={TWO_BOARDS} selectedBoardId="b1" onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId("board-switcher-tab-b2"));
    expect(onSelect).toHaveBeenCalledWith("b2");
  });

  it("renders a disabled-with-tooltip failure state plus a retry affordance", () => {
    const onRetry = vi.fn();
    render(<BoardSwitcher boards={[]} selectedBoardId={null} onSelect={() => {}} failed onRetry={onRetry} />);
    const label = screen.getByTestId("board-switcher-failed");
    expect(label.getAttribute("title")).toBeTruthy();
    fireEvent.click(screen.getByTestId("board-switcher-retry"));
    expect(onRetry).toHaveBeenCalled();
  });

  it("renders a zero-boards empty state with a create CTA", () => {
    const onCreateBoard = vi.fn();
    render(<BoardSwitcher boards={[]} selectedBoardId={null} onSelect={() => {}} onCreateBoard={onCreateBoard} />);
    expect(screen.getByTestId("board-switcher-empty")).toBeDefined();
    fireEvent.click(screen.getByTestId("board-switcher-create"));
    expect(onCreateBoard).toHaveBeenCalled();
  });

  it("prefers rendering data over the loading skeleton when both are present", () => {
    // A background refetch (loading=true) with existing data must keep the tabs.
    render(<BoardSwitcher boards={TWO_BOARDS} selectedBoardId="b1" onSelect={() => {}} loading />);
    expect(screen.queryByTestId("board-switcher-skeleton")).toBeNull();
    expect(screen.getByTestId("board-switcher-tab-b1")).toBeDefined();
  });
});
