import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";
import { ArrowRight } from "lucide-react";
import {
  previewBoardConvertToSimple,
  convertBoardToSimple,
  type ConformColumnMapping,
} from "../api";
import { getErrorMessage } from "@fusion/core";
import type { ToastType } from "../hooks/useToast";
import "./ConvertToSimpleModal.css";

/**
 * ConvertToSimpleModal (U12, R17).
 *
 * "Convert to simple mode" runs the U1 conform mapping on demand for a
 * legacy/advanced board: columns map onto the company template, extra columns are
 * carried as custom columns, and the team is seeded. The user sees the column
 * mapping PREVIEW before applying. Visible in advanced mode (project settings).
 */

const ROLE_LABEL_KEY: Record<string, string> = {
  lead: "boardTeam.roleLead",
  executor: "boardTeam.roleExecutor",
  reviewer: "boardTeam.roleReviewer",
};

interface ConvertToSimpleModalProps {
  isOpen: boolean;
  onClose: () => void;
  boardId: string;
  boardName: string;
  projectId?: string;
  addToast: (message: string, type?: ToastType) => void;
  /** Invalidate the board-scoped payload after applying. */
  onConverted?: () => void;
}

export function ConvertToSimpleModal({
  isOpen,
  onClose,
  boardId,
  boardName,
  projectId,
  addToast,
  onConverted,
}: ConvertToSimpleModalProps) {
  const { t } = useTranslation("app");
  const [mappings, setMappings] = useState<ConformColumnMapping[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setMappings(null);
      setError(null);
      setApplying(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    previewBoardConvertToSimple(boardId, projectId)
      .then((res) => {
        if (cancelled) return;
        setMappings(res.mappings);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(getErrorMessage(err) || t("convertSimple.previewFailed", "Couldn't preview the conversion."));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, boardId, projectId, t]);

  if (!isOpen) return null;

  const handleApply = async () => {
    setApplying(true);
    setError(null);
    try {
      await convertBoardToSimple(boardId, projectId);
      addToast(t("convertSimple.applied", "Board converted to simple mode."), "success");
      onConverted?.();
      onClose();
    } catch (err) {
      setError(getErrorMessage(err) || t("convertSimple.applyFailed", "Couldn't convert the board."));
    } finally {
      setApplying(false);
    }
  };

  const describeTarget = (m: ConformColumnMapping): string => {
    if (m.carried) return t("convertSimple.carried", "Kept as a custom column");
    if (!m.toColumnId) return m.fromColumnName;
    if (m.role) return t(ROLE_LABEL_KEY[m.role] ?? "boardTeam.roleCustom", m.role) + ` (${m.toColumnId})`;
    return m.toColumnId;
  };

  return createPortal(
    <div
      className="convert-simple-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t("convertSimple.title", "Convert to simple mode")}
      data-testid="convert-simple-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget && !applying) onClose();
      }}
    >
      <div className="convert-simple-modal">
        <header className="convert-simple-modal__header">
          <h2 className="convert-simple-modal__title">
            {t("convertSimple.titleFor", "Convert “{{board}}” to simple mode", { board: boardName })}
          </h2>
        </header>

        <div className="convert-simple-modal__body">
          <p className="convert-simple-modal__intro">
            {t(
              "convertSimple.intro",
              "Your columns map onto the company template. Extra columns are kept as custom columns, and the Lead/Executor/Reviewer team is staffed.",
            )}
          </p>

          {loading ? (
            <p className="convert-simple-modal__loading" data-testid="convert-simple-loading">
              {t("convertSimple.loading", "Previewing the mapping…")}
            </p>
          ) : mappings && mappings.length > 0 ? (
            <ul className="convert-simple-mappings" data-testid="convert-simple-mappings">
              {mappings.map((m) => (
                <li key={m.fromColumnId} className="convert-simple-mapping" data-testid={`convert-mapping-${m.fromColumnId}`}>
                  <span className="convert-simple-mapping__from">{m.fromColumnName}</span>
                  <ArrowRight size={14} aria-hidden className="convert-simple-mapping__arrow" />
                  <span className={`convert-simple-mapping__to${m.carried ? " convert-simple-mapping__to--carried" : ""}`}>
                    {describeTarget(m)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            !error && (
              <p className="convert-simple-modal__empty" data-testid="convert-simple-empty">
                {t("convertSimple.alreadySimple", "This board is already on the company template.")}
              </p>
            )
          )}

          {error && (
            <p className="convert-simple-modal__error" role="alert" data-testid="convert-simple-error">
              {error}
            </p>
          )}
        </div>

        <footer className="convert-simple-modal__footer">
          <button type="button" className="btn" onClick={onClose} disabled={applying}>
            {t("common.cancel", "Cancel")}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleApply}
            disabled={applying || loading}
            data-testid="convert-simple-apply"
          >
            {applying ? t("convertSimple.applying", "Converting…") : t("convertSimple.apply", "Convert")}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
