import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";
import { addBoardColumn, fetchAgents, ApiRequestError, type Agent } from "../api";
import { getErrorMessage } from "@fusion/core";
import type { ToastType } from "../hooks/useToast";
import "./AddCustomColumnModal.css";

/**
 * AddCustomColumnModal (U12, R2/R3).
 *
 * The single simple-mode custom-column add flow: name the column, choose its
 * placement (between Executor and Reviewer, or after Reviewer — mirroring the
 * server rule, R2), and pick-or-create its agent. Placement options are limited
 * to the two legal regions; the server is the authority and rejects illegal
 * placement (before todo) and AE3 (an already-staffed agent), which this modal
 * surfaces inline.
 */

interface AddCustomColumnModalProps {
  isOpen: boolean;
  onClose: () => void;
  boardId: string;
  projectId?: string;
  addToast: (message: string, type?: ToastType) => void;
  /** Invalidate the board-scoped payload after the column is added. */
  onColumnAdded?: () => void;
}

export function AddCustomColumnModal({
  isOpen,
  onClose,
  boardId,
  projectId,
  addToast,
  onColumnAdded,
}: AddCustomColumnModalProps) {
  const { t } = useTranslation("app");
  const [name, setName] = useState("");
  const [placement, setPlacement] = useState<"before-review" | "after-review">("before-review");
  const [agentMode, setAgentMode] = useState<"existing" | "create">("create");
  const [existingAgentId, setExistingAgentId] = useState("");
  const [newAgentName, setNewAgentName] = useState("");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) {
      setName("");
      setPlacement("before-review");
      setAgentMode("create");
      setExistingAgentId("");
      setNewAgentName("");
      setError(null);
      setSubmitting(false);
      return;
    }
    const frame = window.requestAnimationFrame(() => nameRef.current?.focus());
    fetchAgents({ includeEphemeral: false }, projectId)
      .then((list) => setAgents(list ?? []))
      .catch(() => setAgents([]));
    return () => window.cancelAnimationFrame(frame);
  }, [isOpen, projectId]);

  // Board-scoped roster: a company-board agent carries a companyBoardId marker;
  // only this board's agents (or markerless ones) are offered for staffing (R3).
  const eligibleAgents = useMemo(
    () =>
      agents.filter((a) => {
        if (a.role === "ceo") return false;
        const marker = a.metadata?.["companyBoardId"];
        return marker == null || marker === boardId;
      }),
    [agents, boardId],
  );

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t("addColumn.nameRequired", "Column name is required."));
      return;
    }
    let agent: { agentId: string } | { create: { name: string } } | undefined;
    if (agentMode === "existing") {
      if (!existingAgentId) {
        setError(t("addColumn.agentRequired", "Pick an agent or create a new one."));
        return;
      }
      agent = { agentId: existingAgentId };
    } else {
      if (!newAgentName.trim()) {
        setError(t("addColumn.newAgentNameRequired", "Name the new agent."));
        return;
      }
      agent = { create: { name: newAgentName.trim() } };
    }

    setSubmitting(true);
    setError(null);
    try {
      await addBoardColumn(boardId, { name: trimmed, placement, agent }, projectId);
      addToast(t("addColumn.added", "Column added."), "success");
      onColumnAdded?.();
      onClose();
    } catch (err) {
      // AE3 + placement rejections arrive as a structured 400 — show inline.
      if (err instanceof ApiRequestError) {
        const reason = err.details?.reason;
        if (reason === "agent-multiple-columns") {
          setError(
            t(
              "addColumn.ae3",
              "That agent already staffs another column on this board. Pick a different agent or create a new one.",
            ),
          );
        } else if (reason === "agent-other-board") {
          setError(t("addColumn.otherBoard", "That agent belongs to another board. Agents are board-scoped."));
        } else if (reason === "custom-column-before-todo") {
          setError(t("addColumn.beforeTodo", "Columns can't be placed before Todo."));
        } else {
          setError(err.message);
        }
      } else {
        setError(getErrorMessage(err) || t("addColumn.failed", "Failed to add the column."));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div
      className="add-column-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t("addColumn.title", "Add a column")}
      data-testid="add-column-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <form className="add-column-modal" onSubmit={handleSubmit}>
        <header className="add-column-modal__header">
          <h2 className="add-column-modal__title">{t("addColumn.title", "Add a column")}</h2>
        </header>

        <div className="add-column-modal__body">
          <label className="add-column-field">
            <span className="add-column-field__label">{t("addColumn.nameLabel", "Column name")}</span>
            <input
              ref={nameRef}
              type="text"
              className="add-column-field__input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("addColumn.namePlaceholder", "e.g. Deploy, Publish, QA")}
              data-testid="add-column-name"
              maxLength={80}
            />
          </label>

          <fieldset className="add-column-placement">
            <legend className="add-column-field__label">{t("addColumn.placementLabel", "Placement")}</legend>
            <label className="add-column-radio" data-testid="add-column-placement-before-review">
              <input
                type="radio"
                name="placement"
                checked={placement === "before-review"}
                onChange={() => setPlacement("before-review")}
              />
              {t("addColumn.beforeReview", "Between In progress and In review")}
            </label>
            <label className="add-column-radio" data-testid="add-column-placement-after-review">
              <input
                type="radio"
                name="placement"
                checked={placement === "after-review"}
                onChange={() => setPlacement("after-review")}
              />
              {t("addColumn.afterReview", "After In review (post-approval, e.g. Deploy)")}
            </label>
          </fieldset>

          <fieldset className="add-column-agent">
            <legend className="add-column-field__label">{t("addColumn.agentLabel", "Agent")}</legend>
            <label className="add-column-radio">
              <input
                type="radio"
                name="agent-mode"
                checked={agentMode === "create"}
                onChange={() => setAgentMode("create")}
              />
              {t("addColumn.createAgent", "Create a new agent")}
            </label>
            {agentMode === "create" && (
              <input
                type="text"
                className="add-column-field__input"
                value={newAgentName}
                onChange={(e) => setNewAgentName(e.target.value)}
                placeholder={t("addColumn.newAgentPlaceholder", "New agent name")}
                data-testid="add-column-new-agent-name"
                maxLength={80}
              />
            )}
            <label className="add-column-radio">
              <input
                type="radio"
                name="agent-mode"
                checked={agentMode === "existing"}
                onChange={() => setAgentMode("existing")}
              />
              {t("addColumn.pickAgent", "Pick an existing agent")}
            </label>
            {agentMode === "existing" && (
              <select
                className="add-column-field__input"
                value={existingAgentId}
                onChange={(e) => setExistingAgentId(e.target.value)}
                data-testid="add-column-existing-agent"
              >
                <option value="">{t("addColumn.selectAgent", "Select an agent…")}</option>
                {eligibleAgents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            )}
          </fieldset>

          {error && (
            <p className="add-column-modal__error" role="alert" data-testid="add-column-error">
              {error}
            </p>
          )}
        </div>

        <footer className="add-column-modal__footer">
          <button type="button" className="btn" onClick={onClose} disabled={submitting}>
            {t("common.cancel", "Cancel")}
          </button>
          <button type="submit" className="btn btn-primary" disabled={submitting} data-testid="add-column-submit">
            {submitting ? t("addColumn.adding", "Adding…") : t("addColumn.add", "Add column")}
          </button>
        </footer>
      </form>
    </div>,
    document.body,
  );
}
