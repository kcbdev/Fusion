import "./BoardSwitcher.css";
import { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { RotateCw } from "lucide-react";
import type { BoardSummary } from "../api";

/**
 * Horizontal board switcher (U10) rendered above the board. Boards are the
 * universal task container in every mode — the lane concept is gone — and this
 * switcher is how the user moves between them.
 *
 * Explicit states:
 *  - loading: a skeleton strip while the boards index loads.
 *  - failure: a disabled-with-tooltip label plus a retry affordance.
 *  - zero boards: a graceful empty state with a create-board CTA (unreachable
 *    after seeding, but handled).
 *  - active: the selected board highlighted; many boards overflow-scroll.
 *
 * Selection is owned by the parent (Board) so it can persist per project and
 * drive the rendered board payload.
 */

export interface BoardSwitcherProps {
  /** Boards index, already ordered by the caller (defensively re-sorted here). */
  boards: BoardSummary[];
  /** Currently selected board id, or null when none is resolved yet. */
  selectedBoardId: string | null;
  /** Apply a board selection. */
  onSelect: (boardId: string) => void;
  /** True while the boards index is loading (first paint / refetch with no data). */
  loading?: boolean;
  /** True when the boards index fetch failed and there is no data to show. */
  failed?: boolean;
  /** Retry the boards index fetch (failure state). */
  onRetry?: () => void;
  /** Open the create-board flow (zero-boards state). Optional. */
  onCreateBoard?: () => void;
}

function BoardSwitcherComponent({
  boards,
  selectedBoardId,
  onSelect,
  loading,
  failed,
  onRetry,
  onCreateBoard,
}: BoardSwitcherProps) {
  const { t } = useTranslation("app");

  const orderedBoards = useMemo(
    () => [...boards].sort((a, b) => a.ordering - b.ordering),
    [boards],
  );

  // Loading skeleton: only when we have nothing to show yet.
  if (loading && orderedBoards.length === 0) {
    return (
      <nav className="board-switcher board-switcher--loading" aria-label={t("boardSwitcher.label", "Boards")} aria-busy="true">
        <div className="board-switcher-strip" data-testid="board-switcher-skeleton">
          {[0, 1, 2].map((i) => (
            <div key={i} className="board-switcher-tab board-switcher-tab--skeleton" aria-hidden="true" />
          ))}
        </div>
      </nav>
    );
  }

  // Fetch failure with no data: disabled label + retry.
  if (failed && orderedBoards.length === 0) {
    return (
      <nav className="board-switcher board-switcher--failed" aria-label={t("boardSwitcher.label", "Boards")}>
        <div className="board-switcher-strip">
          <span
            className="board-switcher-failed-label"
            data-testid="board-switcher-failed"
            title={t("boardSwitcher.loadFailedTooltip", "Couldn't load boards. Check your connection and try again.")}
          >
            {t("boardSwitcher.loadFailed", "Boards unavailable")}
          </span>
          {onRetry && (
            <button
              type="button"
              className="btn btn-sm board-switcher-retry"
              onClick={onRetry}
              data-testid="board-switcher-retry"
            >
              <RotateCw size={14} aria-hidden /> {t("boardSwitcher.retry", "Retry")}
            </button>
          )}
        </div>
      </nav>
    );
  }

  // Zero-boards empty state.
  if (orderedBoards.length === 0) {
    return (
      <nav className="board-switcher board-switcher--empty" aria-label={t("boardSwitcher.label", "Boards")}>
        <div className="board-switcher-strip">
          <span className="board-switcher-empty-label" data-testid="board-switcher-empty">
            {t("boardSwitcher.emptyLabel", "No boards yet")}
          </span>
          {onCreateBoard && (
            <button
              type="button"
              className="btn btn-sm board-switcher-create"
              onClick={onCreateBoard}
              data-testid="board-switcher-create"
            >
              + {t("boardSwitcher.createBoard", "Create a board")}
            </button>
          )}
        </div>
      </nav>
    );
  }

  return (
    <nav className="board-switcher" aria-label={t("boardSwitcher.label", "Boards")} data-testid="board-switcher">
      <div className="board-switcher-strip" role="tablist">
        {orderedBoards.map((board) => {
          const active = board.id === selectedBoardId;
          return (
            <button
              key={board.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={`board-switcher-tab${active ? " board-switcher-tab--active" : ""}`}
              data-testid={`board-switcher-tab-${board.id}`}
              data-active={active ? "true" : "false"}
              onClick={() => onSelect(board.id)}
              title={board.description || board.name}
            >
              {board.name}
            </button>
          );
        })}
        {onCreateBoard && (
          <button
            type="button"
            className="board-switcher-tab board-switcher-tab--create"
            onClick={onCreateBoard}
            data-testid="board-switcher-add"
            title={t("boardSwitcher.createBoard", "Create a board")}
            aria-label={t("boardSwitcher.createBoard", "Create a board")}
          >
            +
          </button>
        )}
      </div>
    </nav>
  );
}

export const BoardSwitcher = memo(BoardSwitcherComponent);
BoardSwitcher.displayName = "BoardSwitcher";
