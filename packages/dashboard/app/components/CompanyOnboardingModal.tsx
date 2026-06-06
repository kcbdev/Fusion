import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Building2, Crown, LayoutGrid, Users, Plus, Check, Bot } from "lucide-react";
import {
  registerProject,
  createGoal,
  createBoard,
  fetchAgents,
  updateAgent,
  updateAgentInstructions,
  type ProjectInfo,
  type ProjectCreateInput,
  type Agent,
  type BoardSummary,
} from "../api";
import { getErrorMessage } from "@fusion/core";
import { DirectoryPicker } from "./DirectoryPicker";
import { AddCustomColumnModal } from "./AddCustomColumnModal";
import { suggestProjectName } from "../utils/projectDetection";
import { useNodes } from "../hooks/useNodes";
import {
  markCompanyOnboardingDone,
  setSelectedBoardForProject,
} from "./company-onboarding-state";
import type { ToastType } from "../hooks/useToast";
import "./CompanyOnboardingModal.css";

/**
 * CompanyOnboardingModal (U12, sub-part B).
 *
 * The five-step, gamified project-creation flow that runs when the company-model
 * flag is ON (it replaces the SetupWizardModal for new projects in that mode).
 * Mirrors AgentOnboardingModal's view-state machine: one `step` drives a single
 * rendered panel and a footer that advances/skips.
 *
 *   1. directory + name  → registerProject (the project is born here)
 *   2. meet the CEO      → optional rename / personality + project Goals
 *   3. first board       → "Create the first department of your company"
 *   4. team setup        → editable role instructions + add-more
 *   5. land on the board → close + select the created board
 *
 * Skippable at ANY step. Skipping never blocks project creation: once step 1
 * completes the project exists; skipping before step 3 falls back to the default
 * board behavior that already exists server-side (board creation just doesn't
 * happen here). On completion OR skip the per-project never-reshown marker is
 * persisted (see company-onboarding-state.ts).
 */

type Step = 1 | 2 | 3 | 4 | 5;

export interface CompanyOnboardingModalProps {
  /** Called once the project is registered (mirrors SetupWizardModal). */
  onProjectRegistered: (project: ProjectInfo) => void;
  /** Called when the flow closes (completed or skipped). */
  onClose: () => void;
  addToast: (message: string, type?: ToastType) => void;
  /** Accepted for SetupWizardModal parity; not consumed by this flow yet. */
  existingProjects?: { name: string; path: string }[];
}

export function CompanyOnboardingModal({
  onProjectRegistered,
  onClose,
  addToast,
}: CompanyOnboardingModalProps) {
  const { t } = useTranslation("app");
  const { nodes } = useNodes();
  const localNodeId = useMemo(() => nodes.find((n) => n.type === "local")?.id, [nodes]);

  const [step, setStep] = useState<Step>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1 — directory + name. The created project drives every later step.
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [nodeId, setNodeId] = useState("");
  const [project, setProject] = useState<ProjectInfo | null>(null);

  // Step 2 — CEO + goals.
  const [ceo, setCeo] = useState<Agent | null>(null);
  const [ceoName, setCeoName] = useState("");
  const [ceoSoul, setCeoSoul] = useState("");
  const [goalTitle, setGoalTitle] = useState("");
  const [goalDescription, setGoalDescription] = useState("");

  // Step 3 — first board.
  const [boardName, setBoardName] = useState("");
  const [boardDescription, setBoardDescription] = useState("");
  const [board, setBoard] = useState<BoardSummary | null>(null);

  // Step 4 — team.
  const [team, setTeam] = useState<Agent[]>([]);
  const [teamLoading, setTeamLoading] = useState(false);
  const [editingInstructions, setEditingInstructions] = useState<Record<string, string>>({});
  const [showAddColumn, setShowAddColumn] = useState(false);

  const handlePathChange = useCallback((next: string) => {
    setPath(next);
    setName((prev) => {
      if (prev && prev !== suggestProjectName(path)) return prev;
      return suggestProjectName(next) || prev;
    });
  }, [path]);

  /** Persist the never-reshown marker and close. */
  const finish = useCallback((outcome: "completed" | "skipped", atStep?: number) => {
    if (project) {
      markCompanyOnboardingDone(project.id, outcome, atStep);
    }
    onClose();
  }, [project, onClose]);

  // ── Step 1: register the project ───────────────────────────────────────────
  const createProject = useCallback(async () => {
    if (busy) return;
    const trimmedPath = path.trim();
    const trimmedName = name.trim();
    if (!trimmedPath || !trimmedName) return;
    setBusy(true);
    setError(null);
    try {
      const input: ProjectCreateInput = {
        name: trimmedName,
        path: trimmedPath,
        isolationMode: "in-process",
        nodeId: nodeId || undefined,
      };
      const created = await registerProject(input);
      setProject(created);
      onProjectRegistered(created);
      // Resolve the seeded CEO (project-level) for step 2.
      try {
        const agents = await fetchAgents({ role: "ceo", includeEphemeral: false }, created.id);
        const resolvedCeo = agents[0] ?? null;
        if (resolvedCeo) {
          setCeo(resolvedCeo);
          setCeoName(resolvedCeo.name);
          setCeoSoul(resolvedCeo.soul ?? "");
        }
      } catch {
        // Non-fatal — step 2 still renders (CEO edits become a no-op).
      }
      setStep(2);
    } catch (err) {
      setError(getErrorMessage(err) || t("companyOnboarding.createProjectFailed", "Failed to create the project"));
    } finally {
      setBusy(false);
    }
  }, [busy, path, name, nodeId, onProjectRegistered, t]);

  // ── Step 2: persist CEO edits + the project goal, then advance ─────────────
  const saveCeoAndGoal = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      if (ceo) {
        const updates: { name?: string; soul?: string } = {};
        if (ceoName.trim() && ceoName.trim() !== ceo.name) updates.name = ceoName.trim();
        if (ceoSoul !== (ceo.soul ?? "")) updates.soul = ceoSoul;
        if (Object.keys(updates).length > 0) {
          const updated = await updateAgent(ceo.id, updates, project?.id);
          setCeo(updated);
        }
      }
      if (goalTitle.trim()) {
        await createGoal(
          { title: goalTitle.trim(), description: goalDescription.trim() || undefined },
          project?.id,
        );
      }
      setStep(3);
    } catch (err) {
      setError(getErrorMessage(err) || t("companyOnboarding.saveCeoFailed", "Failed to save the CEO and goals"));
    } finally {
      setBusy(false);
    }
  }, [ceo, ceoName, ceoSoul, goalTitle, goalDescription, project, t]);

  // ── Step 3: create the first board (reuses the U2 team seed) ────────────────
  const createFirstBoard = useCallback(async () => {
    if (busy) return;
    const trimmed = boardName.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const result = await createBoard(
        { name: trimmed, description: boardDescription.trim() || undefined },
        project?.id,
      );
      setBoard(result.board);
      setStep(4);
    } catch (err) {
      setError(getErrorMessage(err) || t("companyOnboarding.createBoardFailed", "Failed to create the board"));
    } finally {
      setBusy(false);
    }
  }, [busy, boardName, boardDescription, project, t]);

  // ── Step 4: load the seeded team (Lead/Executor/Reviewer) ──────────────────
  useEffect(() => {
    if (step !== 4) return;
    let cancelled = false;
    setTeamLoading(true);
    fetchAgents({ includeEphemeral: false }, project?.id)
      .then((agents) => {
        if (cancelled) return;
        // Show the role agents (Lead/Executor/Reviewer plus any custom-role
        // employees), excluding the CEO. Must match onColumnAdded's filter so a
        // re-mount doesn't drop custom employees from the list.
        const roles = agents.filter((a) => ["lead", "executor", "reviewer", "custom"].includes(a.role));
        setTeam(roles);
        setEditingInstructions(
          Object.fromEntries(roles.map((a) => [a.id, a.instructionsText ?? ""])),
        );
      })
      .catch((err) => {
        if (cancelled) return;
        addToast(getErrorMessage(err) || t("companyOnboarding.teamLoadFailed", "Failed to load the team"), "error");
        setTeam([]);
      })
      .finally(() => {
        if (!cancelled) setTeamLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [step, project, board, addToast, t]);

  const saveTeamAndFinish = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await Promise.all(
        team
          .filter((a) => (editingInstructions[a.id] ?? "") !== (a.instructionsText ?? ""))
          .map((a) =>
            updateAgentInstructions(a.id, { instructionsText: editingInstructions[a.id] ?? "" }, project?.id),
          ),
      );
      setStep(5);
    } catch (err) {
      setError(getErrorMessage(err) || t("companyOnboarding.saveTeamFailed", "Failed to save the team"));
    } finally {
      setBusy(false);
    }
  }, [team, editingInstructions, project, t]);

  // ── Step 5: land on the board ──────────────────────────────────────────────
  const landOnBoard = useCallback(() => {
    if (project && board) {
      setSelectedBoardForProject(project.id, board.id);
    }
    finish("completed");
  }, [project, board, finish]);

  const skip = useCallback(() => {
    finish("skipped", step);
  }, [finish, step]);

  const STEP_META: Record<Step, { icon: typeof Building2; title: string; defaultTitle: string }> = {
    1: { icon: Building2, title: "companyOnboarding.step1Title", defaultTitle: "Found your company" },
    2: { icon: Crown, title: "companyOnboarding.step2Title", defaultTitle: "Meet your CEO" },
    3: { icon: LayoutGrid, title: "companyOnboarding.step3Title", defaultTitle: "Create your first department" },
    4: { icon: Users, title: "companyOnboarding.step4Title", defaultTitle: "Meet your employees" },
    5: { icon: Check, title: "companyOnboarding.step5Title", defaultTitle: "You're all set" },
  };
  const HeaderIcon = STEP_META[step].icon;

  return (
    <div className="modal-overlay open company-onboarding-overlay" role="dialog" aria-modal="true" aria-labelledby="company-onboarding-title">
      <div className="modal company-onboarding-modal" data-testid="company-onboarding-modal" data-step={step}>
        <div className="company-onboarding-header">
          <div className="company-onboarding-heading">
            <HeaderIcon size={22} className="company-onboarding-step-icon" aria-hidden />
            <h2 id="company-onboarding-title" className="company-onboarding-title">
              {t(STEP_META[step].title, STEP_META[step].defaultTitle)}
            </h2>
          </div>
          <div className="company-onboarding-progress" aria-label={t("companyOnboarding.progress", "Step {{step}} of 5", { step })}>
            {([1, 2, 3, 4, 5] as Step[]).map((n) => (
              <span
                key={n}
                className={`company-onboarding-dot${n === step ? " company-onboarding-dot--active" : ""}${n < step ? " company-onboarding-dot--done" : ""}`}
                data-testid={`company-onboarding-dot-${n}`}
                aria-hidden
              />
            ))}
          </div>
        </div>

        <div className="company-onboarding-body">
          {/* STEP 1 — directory + name */}
          {step === 1 && (
            <div className="company-onboarding-step" data-testid="company-onboarding-step-1">
              <p className="company-onboarding-lead">
                {t("companyOnboarding.step1Lead", "Pick the working directory for your company and give it a name.")}
              </p>
              <div className="form-group">
                <label htmlFor="company-onboarding-path">{t("companyOnboarding.directory", "Working directory")}</label>
                <DirectoryPicker
                  value={path}
                  onChange={handlePathChange}
                  nodeId={nodeId || undefined}
                  localNodeId={localNodeId}
                  placeholder={t("companyOnboarding.pathPlaceholder", "/path/to/your/project")}
                />
              </div>
              <div className="form-group">
                <label htmlFor="company-onboarding-name">{t("companyOnboarding.projectName", "Company name")}</label>
                <input
                  id="company-onboarding-name"
                  type="text"
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("companyOnboarding.namePlaceholder", "my-company")}
                  data-testid="company-onboarding-name-input"
                />
              </div>
              {nodes.length > 1 && (
                <div className="form-group">
                  <label htmlFor="company-onboarding-node">{t("setup.runtimeNode", "Runtime Node")}</label>
                  <select id="company-onboarding-node" className="select" value={nodeId} onChange={(e) => setNodeId(e.target.value)}>
                    <option value="">{t("setup.localNode", "Local node")}</option>
                    {nodes.map((node) => (
                      <option key={node.id} value={node.id}>{node.name} ({node.type})</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          {/* STEP 2 — CEO + goals */}
          {step === 2 && (
            <div className="company-onboarding-step" data-testid="company-onboarding-step-2">
              <p className="company-onboarding-lead">
                {t("companyOnboarding.step2Lead", "Your CEO routes every request to the right department. Give it a personality and define what your company is for.")}
              </p>
              <div className="form-group">
                <label htmlFor="company-onboarding-ceo-name">{t("companyOnboarding.ceoName", "CEO name")}</label>
                <input
                  id="company-onboarding-ceo-name"
                  type="text"
                  className="input"
                  value={ceoName}
                  onChange={(e) => setCeoName(e.target.value)}
                  placeholder={t("companyOnboarding.ceoNamePlaceholder", "CEO")}
                  data-testid="company-onboarding-ceo-name"
                />
              </div>
              <div className="form-group">
                <label htmlFor="company-onboarding-ceo-soul">{t("companyOnboarding.ceoPersonality", "CEO personality & instructions")}</label>
                <textarea
                  id="company-onboarding-ceo-soul"
                  className="input"
                  rows={3}
                  value={ceoSoul}
                  onChange={(e) => setCeoSoul(e.target.value)}
                  placeholder={t("companyOnboarding.ceoPersonalityPlaceholder", "How should the CEO think about and route work?")}
                  data-testid="company-onboarding-ceo-soul"
                />
              </div>
              <div className="form-group">
                <label htmlFor="company-onboarding-goal-title">{t("companyOnboarding.goalPrompt", "What is the objective of your company's CEO?")}</label>
                <input
                  id="company-onboarding-goal-title"
                  type="text"
                  className="input"
                  value={goalTitle}
                  onChange={(e) => setGoalTitle(e.target.value)}
                  placeholder={t("companyOnboarding.goalTitlePlaceholder", "Ship a polished v1")}
                  data-testid="company-onboarding-goal-title"
                />
                <textarea
                  className="input company-onboarding-goal-desc"
                  rows={2}
                  value={goalDescription}
                  onChange={(e) => setGoalDescription(e.target.value)}
                  placeholder={t("companyOnboarding.goalDescPlaceholder", "Add detail about this objective (optional)")}
                  data-testid="company-onboarding-goal-desc"
                />
              </div>
            </div>
          )}

          {/* STEP 3 — first board */}
          {step === 3 && (
            <div className="company-onboarding-step" data-testid="company-onboarding-step-3">
              <p className="company-onboarding-lead">
                {t("companyOnboarding.step3Lead", "Create the first department of your company. The CEO uses its name and description to route work here.")}
              </p>
              <div className="form-group">
                <label htmlFor="company-onboarding-board-name">{t("companyOnboarding.boardName", "Department name")}</label>
                <input
                  id="company-onboarding-board-name"
                  type="text"
                  className="input"
                  value={boardName}
                  onChange={(e) => setBoardName(e.target.value)}
                  placeholder={t("companyOnboarding.boardNamePlaceholder", "Engineering")}
                  data-testid="company-onboarding-board-name"
                />
              </div>
              <div className="form-group">
                <label htmlFor="company-onboarding-board-desc">{t("companyOnboarding.boardDescription", "What does this department do?")}</label>
                <textarea
                  id="company-onboarding-board-desc"
                  className="input"
                  rows={3}
                  value={boardDescription}
                  onChange={(e) => setBoardDescription(e.target.value)}
                  placeholder={t("companyOnboarding.boardDescPlaceholder", "Builds and ships the product.")}
                  data-testid="company-onboarding-board-desc"
                />
              </div>
            </div>
          )}

          {/* STEP 4 — team */}
          {step === 4 && (
            <div className="company-onboarding-step" data-testid="company-onboarding-step-4">
              <p className="company-onboarding-lead">
                {t("companyOnboarding.step4Lead", "Here are your employees — give them a clear role in how they execute their missions.")}
              </p>
              {teamLoading ? (
                <div className="company-onboarding-team-loading" data-testid="company-onboarding-team-loading">
                  <Loader2 size={18} className="animate-spin" aria-hidden />
                  <span>{t("companyOnboarding.teamLoading", "Staffing your team…")}</span>
                </div>
              ) : team.length === 0 ? (
                <p className="company-onboarding-team-empty" data-testid="company-onboarding-team-empty">
                  {t("companyOnboarding.teamEmpty", "No employees staffed yet. You can add them later from the board's team panel.")}
                </p>
              ) : (
                <div className="company-onboarding-team">
                  {team.map((a) => (
                    <div key={a.id} className="company-onboarding-employee" data-testid={`company-onboarding-employee-${a.role}`}>
                      <div className="company-onboarding-employee-head">
                        <Bot size={15} aria-hidden />
                        <span className="company-onboarding-employee-name">{a.name}</span>
                        <span className={`company-onboarding-role-badge company-onboarding-role-badge--${a.role}`}>{a.role}</span>
                      </div>
                      <textarea
                        className="input company-onboarding-employee-instructions"
                        rows={2}
                        value={editingInstructions[a.id] ?? ""}
                        onChange={(e) =>
                          setEditingInstructions((prev) => ({ ...prev, [a.id]: e.target.value }))
                        }
                        placeholder={t("companyOnboarding.employeeInstructionsPlaceholder", "How should this role execute its missions?")}
                        data-testid={`company-onboarding-employee-instructions-${a.role}`}
                      />
                    </div>
                  ))}
                </div>
              )}
              {board && (
                <button
                  type="button"
                  className="btn btn-sm company-onboarding-add-employee"
                  onClick={() => setShowAddColumn(true)}
                  data-testid="company-onboarding-add-employee"
                >
                  <Plus size={13} aria-hidden /> {t("companyOnboarding.addEmployee", "Add another employee")}
                </button>
              )}
            </div>
          )}

          {/* STEP 5 — land */}
          {step === 5 && (
            <div className="company-onboarding-step company-onboarding-step--final" data-testid="company-onboarding-step-5">
              <Check size={48} className="company-onboarding-final-icon" aria-hidden />
              <p className="company-onboarding-lead">
                {t("companyOnboarding.step5Lead", "Your company is ready. Head to your board and send your first request to the CEO.")}
              </p>
            </div>
          )}

          {error && (
            <div className="company-onboarding-error" role="alert" data-testid="company-onboarding-error">{error}</div>
          )}
        </div>

        <div className="company-onboarding-footer">
          {step < 5 && (
            <button type="button" className="btn company-onboarding-skip" onClick={skip} disabled={busy} data-testid="company-onboarding-skip">
              {t("companyOnboarding.skip", "Skip")}
            </button>
          )}
          <div className="company-onboarding-footer-spacer" />
          {step === 1 && (
            <button type="button" className="btn btn-primary" onClick={() => void createProject()} disabled={busy || !path.trim() || !name.trim()} data-testid="company-onboarding-next">
              {busy ? <Loader2 size={15} className="animate-spin" /> : null}
              {t("companyOnboarding.createCompany", "Create company")}
            </button>
          )}
          {step === 2 && (
            <button type="button" className="btn btn-primary" onClick={() => void saveCeoAndGoal()} disabled={busy} data-testid="company-onboarding-next">
              {busy ? <Loader2 size={15} className="animate-spin" /> : null}
              {t("common.continue", "Continue")}
            </button>
          )}
          {step === 3 && (
            <button type="button" className="btn btn-primary" onClick={() => void createFirstBoard()} disabled={busy || !boardName.trim()} data-testid="company-onboarding-next">
              {busy ? <Loader2 size={15} className="animate-spin" /> : null}
              {t("companyOnboarding.createDepartment", "Create department")}
            </button>
          )}
          {step === 4 && (
            <button type="button" className="btn btn-primary" onClick={() => void saveTeamAndFinish()} disabled={busy} data-testid="company-onboarding-next">
              {busy ? <Loader2 size={15} className="animate-spin" /> : null}
              {t("common.continue", "Continue")}
            </button>
          )}
          {step === 5 && (
            <button type="button" className="btn btn-primary" onClick={landOnBoard} data-testid="company-onboarding-finish">
              {t("companyOnboarding.goToBoard", "Go to my board")}
            </button>
          )}
        </div>
      </div>

      {board && (
        <AddCustomColumnModal
          isOpen={showAddColumn}
          onClose={() => setShowAddColumn(false)}
          boardId={board.id}
          projectId={project?.id}
          addToast={addToast}
          onColumnAdded={() => {
            // Reload the team so the new employee shows immediately.
            setShowAddColumn(false);
            if (project) {
              void fetchAgents({ includeEphemeral: false }, project.id).then((agents) => {
                const roles = agents.filter((a) => ["lead", "executor", "reviewer", "custom"].includes(a.role));
                setTeam(roles);
                setEditingInstructions((prev) => {
                  const next = { ...prev };
                  for (const a of roles) if (!(a.id in next)) next[a.id] = a.instructionsText ?? "";
                  return next;
                });
              });
            }
          }}
        />
      )}
    </div>
  );
}
