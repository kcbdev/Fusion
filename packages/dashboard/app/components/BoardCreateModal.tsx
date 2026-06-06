import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";
import { createBoard, type BoardSummary } from "../api";
import { getErrorMessage } from "@fusion/core";
import type { ToastType } from "../hooks/useToast";
import "./BoardCreateModal.css";

/**
 * BoardCreateModal (U12, R8).
 *
 * Create a new board from the BoardSwitcher's create CTA. The CEO uses the name +
 * description for routing (R9), so both are first-class fields. The board-type
 * picker renders from a small registry array so plugin board types (e.g.
 * Compound Engineering, U13) can be appended without touching the modal markup.
 *
 * Creating calls POST /boards, which reuses the U2 team seed so the board is born
 * staffed (R8), then switches to the new board.
 */

/** A selectable board type for the picker. The registry is extensible: a plugin
 *  board type adds an entry (gated on the plugin being installed). v1 ships only
 *  the standard type; `available` lets a future type render disabled until its
 *  plugin is present. */
export interface BoardTypeOption {
  id: string;
  /** i18n key for the display label. */
  labelKey: string;
  /** Fallback display label. */
  labelDefault: string;
  /** i18n key for the description shown under the label. */
  descriptionKey: string;
  descriptionDefault: string;
  available: boolean;
  /** When true, selecting this type reveals the LFG-mode toggle (R22). */
  supportsLfg?: boolean;
}

/** The board type id for a Compound Engineering board (U13). Offered only when the
 *  bundled CE plugin is installed; never the default. */
export const COMPOUND_ENGINEERING_BOARD_TYPE_ID = "compound-engineering";

/** The built-in board types. The "Compound Engineering" entry ships present but
 *  `available: false`; the caller flips it on (and may extend the registry) when
 *  the CE plugin is installed, via the `boardTypes` prop. */
export const DEFAULT_BOARD_TYPES: BoardTypeOption[] = [
  {
    id: "standard",
    labelKey: "boardCreate.typeStandard",
    labelDefault: "Standard",
    descriptionKey: "boardCreate.typeStandardDesc",
    descriptionDefault: "Lead → Executor → Reviewer. The default department.",
    available: true,
  },
  {
    id: COMPOUND_ENGINEERING_BOARD_TYPE_ID,
    labelKey: "boardCreate.typeCompoundEngineering",
    labelDefault: "Compound Engineering",
    descriptionKey: "boardCreate.typeCompoundEngineeringDesc",
    descriptionDefault:
      "CE stages run each column: Plan → Work → Code review → Compound. Plan approval on.",
    available: false,
    supportsLfg: true,
  },
];

interface BoardCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called with the created board so the caller switches to it. */
  onCreated: (board: BoardSummary) => void;
  projectId?: string;
  addToast: (message: string, type?: ToastType) => void;
  /** Override/extend the board-type registry (U13 passes CE when installed). */
  boardTypes?: BoardTypeOption[];
}

export function BoardCreateModal({
  isOpen,
  onClose,
  onCreated,
  projectId,
  addToast,
  boardTypes = DEFAULT_BOARD_TYPES,
}: BoardCreateModalProps) {
  const { t } = useTranslation("app");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [boardType, setBoardType] = useState("standard");
  const [lfgMode, setLfgMode] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) {
      setName("");
      setDescription("");
      setBoardType("standard");
      setLfgMode(false);
      setSubmitting(false);
      setError(null);
      return;
    }
    const frame = window.requestAnimationFrame(() => nameRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [isOpen]);

  const availableTypes = useMemo(() => boardTypes.filter((tpe) => tpe.available), [boardTypes]);
  const selectedType = useMemo(
    () => availableTypes.find((tpe) => tpe.id === boardType),
    [availableTypes, boardType],
  );

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t("boardCreate.nameRequired", "Board name is required."));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await createBoard(
        {
          name: trimmed,
          description: description.trim(),
          boardType,
          // LFG is meaningful only for types that support it (CE); omit otherwise
          // so the server applies the type default.
          ...(selectedType?.supportsLfg ? { lfgMode } : {}),
        },
        projectId,
      );
      addToast(
        result.seeded
          ? t("boardCreate.createdStaffed", "Board created and staffed.")
          : t("boardCreate.created", "Board created."),
        "success",
      );
      onCreated(result.board);
      onClose();
    } catch (err) {
      setError(getErrorMessage(err) || t("boardCreate.failed", "Failed to create the board."));
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div
      className="board-create-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t("boardCreate.title", "Create a department")}
      data-testid="board-create-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <form className="board-create-modal" onSubmit={handleSubmit}>
        <header className="board-create-modal__header">
          <h2 className="board-create-modal__title">
            {t("boardCreate.title", "Create a department")}
          </h2>
        </header>

        <div className="board-create-modal__body">
          <label className="board-create-field">
            <span className="board-create-field__label">{t("boardCreate.nameLabel", "Name")}</span>
            <input
              ref={nameRef}
              type="text"
              className="board-create-field__input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("boardCreate.namePlaceholder", "e.g. Backend, Docs, Marketing")}
              data-testid="board-create-name"
              maxLength={120}
            />
          </label>

          <label className="board-create-field">
            <span className="board-create-field__label">{t("boardCreate.descriptionLabel", "Description")}</span>
            <textarea
              className="board-create-field__input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t(
                "boardCreate.descriptionPlaceholder",
                "What this department handles — the CEO uses this to route work.",
              )}
              rows={3}
              data-testid="board-create-description"
              maxLength={1000}
            />
          </label>

          <fieldset className="board-create-types">
            <legend className="board-create-field__label">{t("boardCreate.typeLabel", "Board type")}</legend>
            {availableTypes.map((tpe) => (
              <label
                key={tpe.id}
                className={`board-create-type${boardType === tpe.id ? " board-create-type--selected" : ""}`}
                data-testid={`board-create-type-${tpe.id}`}
              >
                <input
                  type="radio"
                  name="board-type"
                  value={tpe.id}
                  checked={boardType === tpe.id}
                  onChange={() => setBoardType(tpe.id)}
                />
                <span className="board-create-type__text">
                  <span className="board-create-type__label">{t(tpe.labelKey, tpe.labelDefault)}</span>
                  <span className="board-create-type__desc">{t(tpe.descriptionKey, tpe.descriptionDefault)}</span>
                </span>
              </label>
            ))}
          </fieldset>

          {selectedType?.supportsLfg && (
            <label className="board-create-lfg" data-testid="board-create-lfg">
              <input
                type="checkbox"
                checked={lfgMode}
                onChange={(e) => setLfgMode(e.target.checked)}
                data-testid="board-create-lfg-toggle"
              />
              <span className="board-create-type__text">
                <span className="board-create-type__label">
                  {t("boardCreate.lfgLabel", "LFG mode")}
                </span>
                <span className="board-create-type__desc">
                  {t(
                    "boardCreate.lfgDesc",
                    "Run the whole pipeline headless — no questions, no plan-approval hold. Overridable per task.",
                  )}
                </span>
              </span>
            </label>
          )}

          {error && (
            <p className="board-create-modal__error" role="alert" data-testid="board-create-error">
              {error}
            </p>
          )}
        </div>

        <footer className="board-create-modal__footer">
          <button type="button" className="btn" onClick={onClose} disabled={submitting}>
            {t("common.cancel", "Cancel")}
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={submitting}
            data-testid="board-create-submit"
          >
            {submitting ? t("boardCreate.creating", "Creating…") : t("boardCreate.create", "Create board")}
          </button>
        </footer>
      </form>
    </div>,
    document.body,
  );
}
