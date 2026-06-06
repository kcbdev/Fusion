import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getErrorMessage } from "@fusion/core";
import type { Task } from "@fusion/core";
import { moveTaskToBoard, type BoardSummary } from "../api";
import type { ToastType } from "../hooks/useToast";
import { useConfirm } from "../hooks/useConfirm";

/** Task statuses that imply an in-flight session (mirrors TaskDetailModal). */
const ACTIVE_STATUSES = new Set(["planning", "researching", "executing", "finalizing", "merging", "merging-fix"]);

interface MoveToBoardControlProps {
  task: Task;
  projectId?: string;
  /** The project's boards index (from the board-scoped payload the caller
   *  already holds — the control does not fetch). */
  boards: BoardSummary[];
  /** Where null-boardId tasks home (the default board). */
  defaultBoardId: string | null;
  addToast: (message: string, type?: ToastType) => void;
  /** Called with the updated task after a successful move so the caller can
   *  refresh (the move re-homes the task to the target board's Todo, R13). */
  onMoved?: (task: Task) => void;
}

/**
 * Cross-board move affordance (U10, R13). Lists the boards a task can be
 * re-homed to (every board except its current home) and, on selection, calls
 * `POST /tasks/:id/move-to-board` behind a confirm dialog that warns any active
 * session will be aborted and the task restarted on the target board's Todo.
 */
export function MoveToBoardControl({ task, projectId, boards, defaultBoardId, addToast, onMoved }: MoveToBoardControlProps) {
  const { t } = useTranslation("app");
  const { confirm } = useConfirm();
  const [currentBoardId, setCurrentBoardId] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const known = new Set(boards.map((b) => b.id));
    setCurrentBoardId(task.boardId && known.has(task.boardId) ? task.boardId : defaultBoardId);
  }, [boards, defaultBoardId, task.boardId]);

  const hasActiveWork = ACTIVE_STATUSES.has(task.status ?? "") || task.column === "in-progress" || Boolean(task.branch);

  const handleSelect = useCallback(
    async (targetBoardId: string) => {
      if (!targetBoardId || targetBoardId === currentBoardId) return;
      setError(null);
      if (hasActiveWork) {
        const confirmed = await confirm({
          title: t("moveToBoard.warnTitle", "Move task to another board?"),
          message: t(
            "moveToBoard.warnMessage",
            "This task has work in progress. Moving it interrupts execution and restarts it in the target board's To Do. Its branch is kept on the task. Continue?",
          ),
          confirmLabel: t("moveToBoard.warnConfirm", "Move and restart"),
          cancelLabel: t("moveToBoard.warnCancel", "Cancel"),
          danger: true,
        });
        if (!confirmed) return;
      }
      setMoving(true);
      try {
        const updated = await moveTaskToBoard(task.id, targetBoardId, projectId);
        setCurrentBoardId(targetBoardId);
        onMoved?.(updated);
      } catch (err) {
        const message = getErrorMessage(err) || t("moveToBoard.failed", "Failed to move task to board");
        setError(message);
        addToast(message, "error");
      } finally {
        setMoving(false);
      }
    },
    [currentBoardId, hasActiveWork, confirm, t, task.id, projectId, onMoved, addToast],
  );

  // Nothing to move to when there is only the current board (or none).
  const targets = boards.filter((b) => b.id !== currentBoardId);
  if (boards.length <= 1) return null;

  return (
    <div className="detail-move-to-board" data-testid="move-to-board">
      <label className="detail-move-to-board-label" htmlFor="move-to-board-select">
        {t("moveToBoard.label", "Move to board…")}
      </label>
      <select
        id="move-to-board-select"
        className="select"
        data-testid="move-to-board-select"
        value=""
        disabled={moving || targets.length === 0}
        onChange={(e) => void handleSelect(e.target.value)}
      >
        <option value="" disabled>
          {t("moveToBoard.placeholder", "Select a board…")}
        </option>
        {targets.map((board) => (
          <option key={board.id} value={board.id}>
            {board.name}
          </option>
        ))}
      </select>
      {error && (
        <span className="detail-move-to-board-error" role="alert" data-testid="move-to-board-error">
          {error}
        </span>
      )}
    </div>
  );
}
