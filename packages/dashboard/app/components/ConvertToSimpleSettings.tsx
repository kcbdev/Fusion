import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchBoardWorkflows, type BoardSummary } from "../api";
import { ConvertToSimpleModal } from "./ConvertToSimpleModal";
import type { ToastType } from "../hooks/useToast";

/**
 * ConvertToSimpleSettings (U12, R17).
 *
 * The project-settings entry point for converting a legacy/advanced board to
 * simple mode on demand. Lists the project's boards; "Convert" opens a preview
 * modal of the column mapping, then applies the conform mapping + team seed.
 *
 * Visible in advanced mode (it lives in the project General settings section,
 * which advanced users reach); the action is per-board.
 */

interface ConvertToSimpleSettingsProps {
  projectId?: string;
  addToast: (message: string, type?: ToastType) => void;
}

export function ConvertToSimpleSettings({ projectId, addToast }: ConvertToSimpleSettingsProps) {
  const { t } = useTranslation("app");
  const [boards, setBoards] = useState<BoardSummary[] | null>(null);
  const [target, setTarget] = useState<BoardSummary | null>(null);

  const load = () => {
    fetchBoardWorkflows(projectId)
      .then((payload) => setBoards(payload.boards))
      .catch(() => setBoards([]));
  };

  useEffect(() => {
    let cancelled = false;
    fetchBoardWorkflows(projectId)
      .then((payload) => {
        if (!cancelled) setBoards(payload.boards);
      })
      .catch(() => {
        if (!cancelled) setBoards([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return (
    <div className="form-group" data-testid="convert-to-simple-settings">
      <label>{t("convertSimple.settingsLabel", "Convert a board to simple mode")}</label>
      <small>
        {t(
          "convertSimple.settingsHint",
          "Map a legacy or advanced board's columns onto the company template (Lead / Executor / Reviewer), carrying extra columns as custom columns and staffing the team.",
        )}
      </small>
      {boards === null ? (
        <p className="settings-muted">{t("convertSimple.loadingBoards", "Loading boards…")}</p>
      ) : boards.length === 0 ? (
        <p className="settings-muted">{t("convertSimple.noBoards", "No boards to convert.")}</p>
      ) : (
        <ul className="convert-simple-board-list" style={{ listStyle: "none", padding: 0, margin: "8px 0 0" }}>
          {boards.map((b) => (
            <li
              key={b.id}
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "6px 0" }}
            >
              <span>{b.name}</span>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setTarget(b)}
                data-testid={`convert-board-${b.id}`}
              >
                {t("convertSimple.convertBtn", "Convert")}
              </button>
            </li>
          ))}
        </ul>
      )}

      {target && (
        <ConvertToSimpleModal
          isOpen={target !== null}
          onClose={() => setTarget(null)}
          boardId={target.id}
          boardName={target.name}
          projectId={projectId}
          addToast={addToast}
          onConverted={load}
        />
      )}
    </div>
  );
}
