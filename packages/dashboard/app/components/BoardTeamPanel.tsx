import "./BoardTeamPanel.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Users, RotateCw, Pencil, Check, X, Bot, Plus } from "lucide-react";
import { AddCustomColumnModal } from "./AddCustomColumnModal";
import {
  fetchAgents,
  updateAgentInstructions,
  retryBoardTeamSeed,
  type Agent,
  type BoardColumn,
  type BoardTeamMember,
} from "../api";
import { getErrorMessage } from "@fusion/core";
import type { ToastType } from "../hooks/useToast";

/**
 * BoardTeamPanel (U12, R1/R3/R8).
 *
 * The roster for the CURRENT board, column by column, with role badges. Strictly
 * board-scoped (R3): it only shows this board's staffed columns — there is no
 * project-wide agent list and no cross-board transfer.
 *
 * Role columns (lead/executor/reviewer, marked via the company-template `role`
 * marker) expose INSTRUCTIONS EDITING ONLY — no delete/replace (R1). Custom
 * columns (a staffed column with no `role` marker) allow replacing the staffed
 * agent. (The custom-column ADD flow lives in WorkflowColumnPanel; this panel
 * edits the existing roster.)
 *
 * States:
 *  - loading: a skeleton while agents resolve.
 *  - seed-failed: when the board has role columns but no team is staffed yet —
 *    a retry CTA that re-runs the U2 seed via POST /boards/:id/seed-team.
 *  - loaded: the roster.
 */

const ROLE_BADGE: Record<string, { key: string; label: string }> = {
  lead: { key: "boardTeam.roleLead", label: "Lead" },
  executor: { key: "boardTeam.roleExecutor", label: "Executor" },
  reviewer: { key: "boardTeam.roleReviewer", label: "Reviewer" },
};

export interface BoardTeamPanelProps {
  boardId: string;
  boardName: string;
  /** The active board's columns (from the board-scoped payload). */
  columns: BoardColumn[];
  /** columnId → staffed agent (from the board-scoped payload). */
  team: Record<string, BoardTeamMember>;
  projectId?: string;
  addToast: (message: string, type?: ToastType) => void;
  /** Close the panel. */
  onClose: () => void;
  /** Invalidate the board-scoped payload after a seed/instructions change. */
  onTeamChanged?: () => void;
}

interface RosterRow {
  columnId: string;
  columnName: string;
  role?: "lead" | "executor" | "reviewer";
  member?: BoardTeamMember;
}

export function BoardTeamPanel({
  boardId,
  boardName,
  columns,
  team,
  projectId,
  addToast,
  onClose,
  onTeamChanged,
}: BoardTeamPanelProps) {
  const { t } = useTranslation("app");
  const [agentsById, setAgentsById] = useState<Map<string, Agent> | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [editingColumnId, setEditingColumnId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [savingInstructions, setSavingInstructions] = useState(false);
  const [showAddColumn, setShowAddColumn] = useState(false);

  // Resolve the staffed agents so we can show their instructions. Board-scoped:
  // we only look up the agents staffed on THIS board's columns.
  useEffect(() => {
    let cancelled = false;
    setAgentsById(null);
    fetchAgents({ includeEphemeral: false }, projectId)
      .then((agents) => {
        if (cancelled) return;
        setAgentsById(new Map(agents.map((a) => [a.id, a])));
      })
      .catch((err) => {
        if (cancelled) return;
        setAgentsById(new Map());
        addToast(getErrorMessage(err) || t("boardTeam.loadFailed", "Failed to load the team"), "error");
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, boardId, addToast, t]);

  // Build the roster: only role columns and staffed custom columns. The idea
  // intake column (no role, unstaffed) is omitted — it is never part of the team.
  const roster = useMemo<RosterRow[]>(() => {
    const rows: RosterRow[] = [];
    for (const col of columns) {
      const member = team[col.id];
      // A column belongs in the roster if it carries a role (mandatory role
      // column, always shown even if seeding is pending) or is staffed.
      if (!col.role && !member) continue;
      rows.push({ columnId: col.id, columnName: col.name, role: col.role, member });
    }
    return rows;
  }, [columns, team]);

  const hasRoleColumns = useMemo(() => columns.some((c) => c.role), [columns]);
  const staffedRoleCount = useMemo(
    () => columns.filter((c) => c.role && team[c.id]).length,
    [columns, team],
  );
  const roleColumnCount = useMemo(() => columns.filter((c) => c.role).length, [columns]);

  // Seed-failed: the board declares role columns but none are staffed.
  const seedFailed = hasRoleColumns && staffedRoleCount === 0;

  const handleRetrySeed = useCallback(async () => {
    setSeeding(true);
    try {
      const result = await retryBoardTeamSeed(boardId, projectId);
      if (result.seeded) {
        addToast(t("boardTeam.seedSucceeded", "Team staffed."), "success");
        onTeamChanged?.();
      } else {
        addToast(
          t(
            "boardTeam.seedSkipped",
            "Nothing to staff — the company model may be disabled for this project.",
          ),
          "info",
        );
      }
    } catch (err) {
      addToast(getErrorMessage(err) || t("boardTeam.seedFailed", "Couldn't staff the team. Try again."), "error");
    } finally {
      setSeeding(false);
    }
  }, [boardId, projectId, addToast, t, onTeamChanged]);

  const beginEdit = useCallback(
    (columnId: string, agentId: string) => {
      const agent = agentsById?.get(agentId);
      setEditingColumnId(columnId);
      setEditingText(agent?.instructionsText ?? "");
    },
    [agentsById],
  );

  const cancelEdit = useCallback(() => {
    setEditingColumnId(null);
    setEditingText("");
  }, []);

  const saveInstructions = useCallback(
    async (agentId: string) => {
      setSavingInstructions(true);
      try {
        const updated = await updateAgentInstructions(agentId, { instructionsText: editingText }, projectId);
        setAgentsById((prev) => {
          const next = new Map(prev ?? []);
          next.set(agentId, updated);
          return next;
        });
        addToast(t("boardTeam.instructionsSaved", "Instructions saved."), "success");
        setEditingColumnId(null);
        setEditingText("");
      } catch (err) {
        addToast(getErrorMessage(err) || t("boardTeam.instructionsSaveFailed", "Failed to save instructions"), "error");
      } finally {
        setSavingInstructions(false);
      }
    },
    [editingText, projectId, addToast, t],
  );

  const loading = agentsById === null;

  return (
    <div className="board-team-panel" data-testid="board-team-panel" role="region" aria-label={t("boardTeam.title", "Team")}>
      <header className="board-team-panel__header">
        <h3 className="board-team-panel__title">
          <Users size={16} aria-hidden /> {t("boardTeam.titleFor", "Team — {{board}}", { board: boardName })}
        </h3>
        <button
          type="button"
          className="board-team-panel__close"
          onClick={onClose}
          aria-label={t("common.close", "Close")}
          data-testid="board-team-close"
        >
          <X size={16} aria-hidden />
        </button>
      </header>

      {loading ? (
        <div className="board-team-panel__body" data-testid="board-team-skeleton" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="board-team-row board-team-row--skeleton" aria-hidden />
          ))}
        </div>
      ) : seedFailed ? (
        <div className="board-team-panel__seed-failed" data-testid="board-team-seed-failed">
          <p className="board-team-panel__seed-failed-msg">
            {t(
              "boardTeam.seedFailedMessage",
              "This board's team isn't staffed yet ({{staffed}}/{{total}} roles). Retry to staff the Lead, Executor, and Reviewer.",
              { staffed: staffedRoleCount, total: roleColumnCount },
            )}
          </p>
          <button
            type="button"
            className="btn btn-primary board-team-panel__seed-retry"
            onClick={handleRetrySeed}
            disabled={seeding}
            data-testid="board-team-seed-retry"
          >
            <RotateCw size={14} aria-hidden /> {seeding ? t("boardTeam.seeding", "Staffing…") : t("boardTeam.seedRetry", "Staff the team")}
          </button>
        </div>
      ) : (
        <div className="board-team-panel__body">
          {roster.length === 0 ? (
            <p className="board-team-panel__empty" data-testid="board-team-empty">
              {t("boardTeam.empty", "No team members on this board yet.")}
            </p>
          ) : (
            roster.map((row) => {
              const isRole = Boolean(row.role);
              const agent = row.member ? agentsById?.get(row.member.agentId) : undefined;
              const editing = editingColumnId === row.columnId;
              return (
                <div
                  key={row.columnId}
                  className="board-team-row"
                  data-testid={`board-team-row-${row.columnId}`}
                  data-role={row.role ?? "custom"}
                >
                  <div className="board-team-row__head">
                    <span className="board-team-row__column">{row.columnName}</span>
                    <span
                      className={`board-team-badge board-team-badge--${row.role ?? "custom"}`}
                      data-testid={`board-team-badge-${row.columnId}`}
                    >
                      {row.role
                        ? t(ROLE_BADGE[row.role]?.key ?? "boardTeam.roleCustom", ROLE_BADGE[row.role]?.label ?? row.role)
                        : t("boardTeam.roleCustom", "Custom")}
                    </span>
                  </div>
                  <div className="board-team-row__agent">
                    <Bot size={14} aria-hidden />
                    <span className="board-team-row__agent-name">
                      {row.member?.agentName ?? t("boardTeam.unstaffed", "Unstaffed")}
                    </span>
                  </div>

                  {/* Role columns: instructions editing ONLY (R1 — no delete/replace). */}
                  {isRole && row.member && (
                    <div className="board-team-row__instructions">
                      {editing ? (
                        <>
                          <textarea
                            className="board-team-row__instructions-input"
                            value={editingText}
                            onChange={(e) => setEditingText(e.target.value)}
                            rows={4}
                            placeholder={t(
                              "boardTeam.instructionsPlaceholder",
                              "Add instructions for how this role executes its missions…",
                            )}
                            data-testid={`board-team-instructions-input-${row.columnId}`}
                          />
                          <div className="board-team-row__instructions-actions">
                            <button
                              type="button"
                              className="btn btn-sm btn-primary"
                              onClick={() => saveInstructions(row.member!.agentId)}
                              disabled={savingInstructions}
                              data-testid={`board-team-instructions-save-${row.columnId}`}
                            >
                              <Check size={13} aria-hidden /> {t("common.save", "Save")}
                            </button>
                            <button type="button" className="btn btn-sm" onClick={cancelEdit} disabled={savingInstructions}>
                              {t("common.cancel", "Cancel")}
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <p className="board-team-row__instructions-text">
                            {agent?.instructionsText?.trim()
                              ? agent.instructionsText
                              : t("boardTeam.noInstructions", "No custom instructions.")}
                          </p>
                          <button
                            type="button"
                            className="btn btn-sm board-team-row__edit"
                            onClick={() => beginEdit(row.columnId, row.member!.agentId)}
                            data-testid={`board-team-instructions-edit-${row.columnId}`}
                          >
                            <Pencil size={13} aria-hidden /> {t("boardTeam.editInstructions", "Edit instructions")}
                          </button>
                        </>
                      )}
                    </div>
                  )}

                  {/* Custom columns: replace staffing is allowed (R1). The
                      replace flow reuses the column-management surface; here we
                      surface the affordance hint. Role columns never show this. */}
                  {!isRole && row.member && (
                    <p className="board-team-row__custom-hint" data-testid={`board-team-custom-hint-${row.columnId}`}>
                      {t(
                        "boardTeam.customReplaceHint",
                        "Custom column — replace its agent from the board's column settings.",
                      )}
                    </p>
                  )}
                </div>
              );
            })
          )}
          <button
            type="button"
            className="btn btn-sm board-team-panel__add-column"
            onClick={() => setShowAddColumn(true)}
            data-testid="board-team-add-column"
          >
            <Plus size={13} aria-hidden /> {t("boardTeam.addColumn", "Add a column")}
          </button>
        </div>
      )}

      <AddCustomColumnModal
        isOpen={showAddColumn}
        onClose={() => setShowAddColumn(false)}
        boardId={boardId}
        projectId={projectId}
        addToast={addToast}
        onColumnAdded={() => {
          onTeamChanged?.();
        }}
      />
    </div>
  );
}
