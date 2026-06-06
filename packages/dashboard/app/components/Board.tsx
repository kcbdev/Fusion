import type { Task, TaskDetail, Column as ColumnType, TaskCreateInput, GithubIssueAction, UiMode } from "@fusion/core";
import { isColumn } from "@fusion/core";
import { sortTasksForDisplayColumn } from "./taskSorting";
import { Column } from "./Column";
import { BoardSwitcher } from "./BoardSwitcher";
import { BoardTeamPanel } from "./BoardTeamPanel";
import { BoardCreateModal, DEFAULT_BOARD_TYPES, type BoardTypeOption } from "./BoardCreateModal";
import { Users } from "lucide-react";
import type { ToastType } from "../hooks/useToast";
import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { fetchWorkflowSteps, fetchBoardWorkflows, promoteTask, getBoardTypes, type ModelInfo, type BoardWorkflowsPayload } from "../api";
import { useBlockerFanout } from "../hooks/useBlockerFanout";
import { recordResumeEvent } from "../utils/resumeInstrumentation";
import { subscribeSse } from "../sse-bus";
import "./Board.css";

/** localStorage key prefix for the per-project selected board (U10). */
const SELECTED_BOARD_STORAGE_PREFIX = "kb-dashboard-selected-board";

function selectedBoardStorageKey(projectId?: string): string {
  return `${SELECTED_BOARD_STORAGE_PREFIX}:${projectId ?? "__global__"}`;
}

function readPersistedBoardId(projectId?: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(selectedBoardStorageKey(projectId));
  } catch {
    return null;
  }
}

function persistBoardId(projectId: string | undefined, boardId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(selectedBoardStorageKey(projectId), boardId);
  } catch {
    /* ignore quota / serialization errors */
  }
}

interface BoardProps {
  tasks: Task[];
  projectId?: string;
  maxConcurrent: number;
  onMoveTask: (id: string, column: ColumnType) => Promise<Task>;
  onPauseTask?: (id: string) => Promise<Task>;
  onOpenDetail: (task: Task | TaskDetail) => void;
  onOpenGroupModal?: (groupId: string) => void;
  addToast: (message: string, type?: ToastType) => void;
  onQuickCreate?: (input: TaskCreateInput) => Promise<Task | void>;
  onNewTask: () => void;
  autoMerge: boolean;
  onToggleAutoMerge: () => void;
  globalPaused?: boolean;
  onUpdateTask?: (
    id: string,
    updates: { title?: string; description?: string; dependencies?: string[] }
  ) => Promise<Task>;
  onRetryTask?: (id: string) => Promise<Task>;
  onArchiveTask?: (id: string, options?: { removeLineageReferences?: boolean }) => Promise<Task>;
  onUnarchiveTask?: (id: string) => Promise<Task>;
  onDeleteTask?: (id: string, options?: {
    removeDependencyReferences?: boolean;
    removeLineageReferences?: boolean;
    githubIssueAction?: GithubIssueAction;
  }) => Promise<Task>;
  onArchiveAllDone?: () => Promise<Task[]>;
  /** Lazy-load archived tasks. Called the first time the user expands the archived column. */
  onLoadArchivedTasks?: () => Promise<void>;
  searchQuery?: string;
  availableModels?: ModelInfo[];
  /**
   * Called when the user clicks the "Plan" button in the inline create card.
   */
  onPlanningMode?: (initialPlan: string) => void;
  /**
   * Called when the user clicks the "Subtask" button in the inline create card.
   */
  onSubtaskBreakdown?: (description: string) => void;
  onOpenDetailWithTab?: (task: Task | TaskDetail, initialTab: "changes" | "retries") => void;
  favoriteProviders?: string[];
  favoriteModels?: string[];
  onToggleFavorite?: (provider: string) => void;
  onToggleModelFavorite?: (modelId: string) => void;
  /** Project-level stuck task timeout in milliseconds (undefined = disabled) */
  taskStuckTimeoutMs?: number;
  /** Called when user clicks a mission badge on a task card */
  onOpenMission?: (missionId: string) => void;
  /** Age threshold in milliseconds before high fan-out blockers escalate in dashboard surfaces. */
  staleHighFanoutBlockerAgeThresholdMs?: number;
  /** Timestamp (ms) when task data was last confirmed fresh from the server. Used for freshness-aware stuck detection. */
  lastFetchTimeMs?: number;
  /** Whether GitHub CLI auth is available for creating PRs from task cards. */
  prAuthAvailable?: boolean;
  /** Simple/advanced UI mode (U11). In simple mode cards suppress branch/worktree
   *  chrome and non-linear boards render read-only. */
  uiMode?: UiMode;
  /** Switches the app to advanced mode — used by the degraded-board affordance. */
  onSwitchToAdvancedMode?: () => void;
}


const EMPTY_WORKFLOW_STEP_NAME_LOOKUP: ReadonlyMap<string, string> = new Map();
let boardWasPreviouslyInactive = false;

function areWorkflowNameLookupsEqual(previous: ReadonlyMap<string, string>, next: ReadonlyMap<string, string>): boolean {
  if (previous.size !== next.size) return false;
  for (const [key, value] of previous) {
    if (next.get(key) !== value) return false;
  }
  return true;
}

export function Board({ tasks, projectId, maxConcurrent, onMoveTask, onPauseTask, onOpenDetail, onOpenGroupModal, addToast, onQuickCreate, onNewTask, autoMerge, onToggleAutoMerge, globalPaused, onUpdateTask, onRetryTask, onArchiveTask, onUnarchiveTask, onDeleteTask, onArchiveAllDone, onLoadArchivedTasks, searchQuery = "", availableModels, onPlanningMode, onSubtaskBreakdown, onOpenDetailWithTab, favoriteProviders, favoriteModels, onToggleFavorite, onToggleModelFavorite, taskStuckTimeoutMs, onOpenMission, staleHighFanoutBlockerAgeThresholdMs, lastFetchTimeMs, prAuthAvailable, uiMode = "advanced", onSwitchToAdvancedMode }: BoardProps) {
  const { t } = useTranslation("app");
  const [archivedCollapsed, setArchivedCollapsed] = useState(true);
  const archivedLoadedRef = useRef(false);
  const [workflowStepNameLookup, setWorkflowStepNameLookup] = useState<ReadonlyMap<string, string>>(EMPTY_WORKFLOW_STEP_NAME_LOOKUP);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const blockerFanoutMap = useBlockerFanout(tasks, {
    staleHighFanoutAgeThresholdMs: staleHighFanoutBlockerAgeThresholdMs,
  });
  // Normalized search-active signal: trimmed and non-empty
  const isSearchActive = searchQuery.trim() !== "";

  useEffect(() => {
    recordResumeEvent({
      view: "Board",
      trigger: boardWasPreviouslyInactive ? "route-active" : "remount",
      projectId,
      replayAttempted: false,
    });
    boardWasPreviouslyInactive = false;

    return () => {
      boardWasPreviouslyInactive = true;
      recordResumeEvent({
        view: "Board",
        trigger: "route-inactive",
        projectId,
        replayAttempted: false,
      });
    };
  }, [projectId]);

  const handleToggleArchivedCollapse = useCallback(() => {
    setArchivedCollapsed((current) => {
      const next = !current;
      if (!next && !archivedLoadedRef.current && onLoadArchivedTasks) {
        archivedLoadedRef.current = true;
        void onLoadArchivedTasks();
      }
      return next;
    });
  }, [onLoadArchivedTasks]);

  useEffect(() => {
    let cancelled = false;

    fetchWorkflowSteps(projectId)
      .then((steps) => {
        if (cancelled) return;

        const nextLookup = new Map(steps.map((step) => [step.id, step.name] as const));
        setWorkflowStepNameLookup((previous) => (
          areWorkflowNameLookupsEqual(previous, nextLookup) ? previous : nextLookup
        ));
      })
      .catch(() => {
        if (cancelled) return;
        setWorkflowStepNameLookup((previous) => (previous.size === 0 ? previous : EMPTY_WORKFLOW_STEP_NAME_LOOKUP));
      });

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // FN-4574 + FN-001 diagnosis: on iOS Safari, the mobile board can occasionally
  // snap against stale layout/visualViewport metrics before flex columns resolve,
  // both on initial mount and on pageshow/bfcache restore after backgrounding.
  // We keep the FN-001 baseline (`scroll-snap-type: x proximity` +
  // `overflow-anchor: none`) and only stabilize via reflow + scroll offset
  // normalization; do NOT reintroduce `scroll-snap-type: x mandatory`.
  useEffect(() => {
    if (!window.matchMedia("(max-width: 768px)").matches) {
      return;
    }

    let rafId: number | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const runStabilization = () => {
      const boardEl = boardRef.current;
      if (!boardEl) return;
      void boardEl.offsetWidth;
      boardEl.scrollLeft = 0;
    };

    const scheduleStabilization = () => {
      if (typeof window.requestAnimationFrame === "function") {
        if (rafId !== null) {
          window.cancelAnimationFrame(rafId);
        }
        rafId = window.requestAnimationFrame(() => {
          rafId = null;
          runStabilization();
        });
        return;
      }

      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      timeoutId = setTimeout(() => {
        timeoutId = null;
        runStabilization();
      }, 0);
    };

    const handlePageShow = (event: PageTransitionEvent) => {
      const viewportScale = window.visualViewport?.scale ?? 1;
      if (event.persisted || viewportScale > 1.0001) {
        scheduleStabilization();
      }
    };

    const visualViewport = window.visualViewport;
    const handleViewportResize = () => {
      scheduleStabilization();
    };

    scheduleStabilization();
    window.addEventListener("pageshow", handlePageShow);
    if (typeof visualViewport?.addEventListener === "function") {
      visualViewport.addEventListener("resize", handleViewportResize);
    }

    return () => {
      window.removeEventListener("pageshow", handlePageShow);
      if (typeof visualViewport?.removeEventListener === "function") {
        visualViewport.removeEventListener("resize", handleViewportResize);
      }
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
    };
  }, []);

  // ── U10 board-scoped board ────────────────────────────────────────────────
  // Boards are the universal task container in EVERY mode; the lane concept is
  // gone. We fetch the board-scoped payload (boards index + per-board columns,
  // team, taskIds + defaultBoardId), render ONE board at a time, and switch via
  // the BoardSwitcher. Selection persists per project.
  const [boardData, setBoardData] = useState<BoardWorkflowsPayload | null>(null);
  const [boardFetchFailed, setBoardFetchFailed] = useState(false);
  const draggingTaskIdRef = useRef<string | null>(null);

  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(() => readPersistedBoardId(projectId));

  // Re-read the persisted selection when the project changes.
  useEffect(() => {
    setSelectedBoardId(readPersistedBoardId(projectId));
  }, [projectId]);

  // Fetch the board-scoped payload. Deliberately NOT keyed on `tasks` — that
  // refetched on every SSE tick. Instead we refetch on project change and when
  // the tab regains visibility/focus. A stale-response guard (monotonic
  // sequence ref) drops out-of-order responses. `workflow:*` and `board:*` SSE
  // events drive invalidation; the visibility/focus refetch is a stopgap for
  // missed events / reconnects.
  const boardFetchSeqRef = useRef(0);
  useEffect(() => {
    const runFetch = () => {
      const seq = ++boardFetchSeqRef.current;
      fetchBoardWorkflows(projectId)
        .then((payload) => {
          if (seq !== boardFetchSeqRef.current) return;
          setBoardData(payload);
          setBoardFetchFailed(false);
        })
        .catch(() => {
          if (seq !== boardFetchSeqRef.current) return;
          setBoardFetchFailed(true);
        });
    };
    runFetch();
    // On tab return both `visibilitychange` and `window.focus` fire, which
    // would launch two concurrent payload fetches. Coalesce them with a short
    // time guard so only the first wins within the window.
    let lastVisibleRefetchAt = 0;
    const onVisible = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastVisibleRefetchAt < 500) return;
      lastVisibleRefetchAt = now;
      runFetch();
    };
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);
    if (typeof window !== "undefined") window.addEventListener("focus", onVisible);
    const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
    const unsubscribe = subscribeSse(`/api/events${query}`, {
      events: {
        "workflow:created": runFetch,
        "workflow:updated": runFetch,
        "workflow:deleted": runFetch,
        "board:created": runFetch,
        "board:updated": runFetch,
        "board:deleted": runFetch,
      },
    });
    return () => {
      // Advance the seq so any in-flight response is dropped on cleanup.
      boardFetchSeqRef.current++;
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible);
      if (typeof window !== "undefined") window.removeEventListener("focus", onVisible);
      unsubscribe();
    };
  }, [projectId]);

  const boards = boardData?.boards ?? [];
  const defaultBoardId = boardData?.defaultBoardId ?? null;

  // Resolve the effective selected board: persisted selection if still valid,
  // else the default board, else the first board by ordering. Reconcile the
  // selection state + persistence once boards load.
  const resolvedBoardId = useMemo(() => {
    if (boards.length === 0) return null;
    const ids = new Set(boards.map((b) => b.id));
    if (selectedBoardId && ids.has(selectedBoardId)) return selectedBoardId;
    if (defaultBoardId && ids.has(defaultBoardId)) return defaultBoardId;
    return [...boards].sort((a, b) => a.ordering - b.ordering)[0]?.id ?? null;
  }, [boards, selectedBoardId, defaultBoardId]);

  useEffect(() => {
    if (resolvedBoardId && resolvedBoardId !== selectedBoardId) {
      setSelectedBoardId(resolvedBoardId);
      persistBoardId(projectId, resolvedBoardId);
    }
  }, [resolvedBoardId, selectedBoardId, projectId]);

  const handleSelectBoard = useCallback((boardId: string) => {
    setSelectedBoardId(boardId);
    persistBoardId(projectId, boardId);
  }, [projectId]);

  const handleRetryBoards = useCallback(() => {
    setBoardFetchFailed(false);
    const seq = ++boardFetchSeqRef.current;
    fetchBoardWorkflows(projectId)
      .then((payload) => {
        if (seq !== boardFetchSeqRef.current) return;
        setBoardData(payload);
        setBoardFetchFailed(false);
      })
      .catch(() => {
        if (seq !== boardFetchSeqRef.current) return;
        setBoardFetchFailed(true);
      });
  }, [projectId]);

  // ── U12 team panel + board creation ───────────────────────────────────────
  const [showTeamPanel, setShowTeamPanel] = useState(false);
  const [showCreateBoard, setShowCreateBoard] = useState(false);

  // U13: the set of board-type ids the server offers (plugin-gated types like
  // Compound Engineering appear only when their plugin is installed). Defaults to
  // the always-available "standard" so the picker works before the probe resolves.
  const [availableBoardTypeIds, setAvailableBoardTypeIds] = useState<Set<string>>(
    () => new Set(["standard"]),
  );
  useEffect(() => {
    let cancelled = false;
    getBoardTypes(projectId)
      .then((res) => {
        if (cancelled) return;
        setAvailableBoardTypeIds(new Set(res.types.map((tpe) => tpe.id)));
      })
      .catch(() => {
        // Best-effort: keep the standard-only default on probe failure.
        if (!cancelled) setAvailableBoardTypeIds(new Set(["standard"]));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);
  // Mark each registry type available per the server probe (U13) so the modal
  // renders plugin-gated types only when installed, never as the default.
  const boardTypeOptions: BoardTypeOption[] = useMemo(
    () =>
      DEFAULT_BOARD_TYPES.map((tpe) => ({
        ...tpe,
        available: availableBoardTypeIds.has(tpe.id),
      })),
    [availableBoardTypeIds],
  );

  // Force a board-payload refetch (after a seed/team/board change). Bumps the
  // fetch seq and re-fetches; mirrors handleRetryBoards without clearing failure.
  const refetchBoards = useCallback(() => {
    const seq = ++boardFetchSeqRef.current;
    fetchBoardWorkflows(projectId)
      .then((payload) => {
        if (seq !== boardFetchSeqRef.current) return;
        setBoardData(payload);
        setBoardFetchFailed(false);
      })
      .catch(() => {
        if (seq !== boardFetchSeqRef.current) return;
        setBoardFetchFailed(true);
      });
  }, [projectId]);

  const handleBoardCreated = useCallback((board: { id: string }) => {
    refetchBoards();
    setSelectedBoardId(board.id);
    persistBoardId(projectId, board.id);
  }, [refetchBoards, projectId]);

  const handlePromote = useCallback(async (taskId: string) => {
    await promoteTask(taskId, projectId);
  }, [projectId]);

  const getDraggingTaskId = useCallback(() => draggingTaskIdRef.current, []);

  const activeBoardPayload = resolvedBoardId ? boardData?.boardPayloads[resolvedBoardId] ?? null : null;

  // Tasks homed on the active board: a task belongs to its `boardId`, or to the
  // default board when it has no `boardId` (legacy/unmigrated). We compute this
  // directly from the task list (already search-filtered by the parent) rather
  // than trusting the server's `taskIds`, because the prop is the live SSE
  // source of truth and includes only the currently-visible tasks.
  const boardTasks = useMemo(() => {
    if (!resolvedBoardId) return [] as Task[];
    // Build the board-id set once (O(boards)) instead of scanning `boards` per
    // task, keeping this O(tasks + boards) rather than O(tasks × boards).
    const boardIds = new Set(boards.map((b) => b.id));
    // Home for a null/unknown-boardId task: the configured default board, or —
    // when no default is set (server omitted it) — the currently resolved board.
    // A visible-but-not-technically-perfect placement beats silently dropping
    // legacy tasks off every board.
    const fallbackHomeId = defaultBoardId ?? resolvedBoardId;
    return tasks.filter((task) => {
      const homeBoardId = task.boardId && boardIds.has(task.boardId)
        ? task.boardId
        : fallbackHomeId;
      return homeBoardId === resolvedBoardId;
    });
  }, [tasks, resolvedBoardId, defaultBoardId, boards]);

  // Visible columns for the active board: archived / hidden-from-board columns
  // are surfaced separately (archived) or hidden.
  const allColumns = activeBoardPayload?.columns ?? [];
  const visibleColumns = useMemo(
    () => allColumns.filter((col) => !col.flags.archived && !col.flags.hiddenFromBoard),
    [allColumns],
  );
  const archivedColumn = useMemo(
    () => allColumns.find((col) => col.flags.archived) ?? null,
    [allColumns],
  );

  // Group + sort tasks by column id for the active board (stable per render).
  const tasksByColumn = useMemo(() => {
    const grouped: Record<string, Task[]> = {};
    for (const col of allColumns) grouped[col.id] = [];
    // A task whose column id isn't a recognized column buckets into the board's
    // intake/first column rather than a hardcoded "triage" — boards without a
    // triage column (e.g. CE-like boards) would otherwise hide the task.
    const fallbackColumnId = allColumns[0]?.id ?? "triage";
    for (const task of boardTasks) {
      const columnId = isColumn(task.column) ? task.column : fallbackColumnId;
      (grouped[columnId] ??= []).push(task);
    }
    for (const col of allColumns) {
      grouped[col.id] = sortTasksForDisplayColumn(grouped[col.id] ?? [], col.id as ColumnType);
    }
    return grouped;
  }, [boardTasks, allColumns]);

  // Drag pre-check (R17): adjacency + capacity from the active board's column
  // metadata. Boards are the task container — a card stays on its board while
  // dragging between columns (cross-board moves are an explicit action), so
  // there is no cross-lane workflow-mismatch rejection here. Deterministic
  // rejections return a messageKey (no-move); null = allowed.
  const canDropTask = useCallback((taskId: string, targetColumnId: string): string | null => {
    if (!activeBoardPayload) return null;
    const sourceTask = boardTasks.find((t) => t.id === taskId);
    if (!sourceTask) return null;
    const targetCol = activeBoardPayload.columns.find((c) => c.id === targetColumnId);
    if (!targetCol) return "board.rejection.unknownColumn";
    // Capacity pre-check: a wip-flagged column that is already full rejects.
    if (targetCol.flags.countsTowardWip) {
      const occupants = boardTasks.filter((t) => t.column === targetColumnId).length;
      if (Number.isFinite(maxConcurrent) && maxConcurrent > 0 && sourceTask.column !== targetColumnId && occupants >= maxConcurrent) {
        return "board.rejection.capacityExhausted";
      }
    }
    return null;
  }, [activeBoardPayload, boardTasks, maxConcurrent]);

  const makeCanDrop = useCallback(
    (targetColumnId: string) => (taskId: string) => canDropTask(taskId, targetColumnId),
    [canDropTask],
  );

  // FN-4380: GitHub badge state comes from persisted task fields and live
  // WebSocket `badge:updated` messages. We do NOT eagerly call
  // `/api/github/batch-status` on board load.

  const team = activeBoardPayload?.team ?? {};
  const loading = boardData === null && !boardFetchFailed;

  // Degraded board (U11, AE7): a board whose workflow violates the simple-mode
  // linearity invariant (split/join graph) renders READ-ONLY in simple mode with
  // an "open in advanced editor" affordance. `linear` defaults to true when the
  // server omits it (older servers / not-yet-loaded), so the board stays
  // interactive unless the server positively reports a non-linear shape.
  const isDegradedInSimpleMode =
    uiMode === "simple" && activeBoardPayload != null && activeBoardPayload.linear === false;

  const activeBoardSummary = useMemo(
    () => boards.find((b) => b.id === resolvedBoardId) ?? null,
    [boards, resolvedBoardId],
  );

  return (
    <>
      <div className="board-toolbar">
        <BoardSwitcher
          boards={boards}
          selectedBoardId={resolvedBoardId}
          onSelect={handleSelectBoard}
          loading={loading}
          failed={boardFetchFailed}
          onRetry={handleRetryBoards}
          onCreateBoard={() => setShowCreateBoard(true)}
        />
        {resolvedBoardId && (
          <button
            type="button"
            className="btn btn-sm board-team-button"
            onClick={() => setShowTeamPanel((v) => !v)}
            data-testid="board-team-button"
            aria-pressed={showTeamPanel}
          >
            <Users size={14} aria-hidden /> {t("boardTeam.button", "Team")}
          </button>
        )}
      </div>
      {showTeamPanel && resolvedBoardId && activeBoardPayload && (
        <div className="board-team-panel-host" data-testid="board-team-panel-host">
          <BoardTeamPanel
            boardId={resolvedBoardId}
            boardName={activeBoardSummary?.name ?? resolvedBoardId}
            columns={activeBoardPayload.columns}
            team={activeBoardPayload.team}
            projectId={projectId}
            addToast={addToast}
            onClose={() => setShowTeamPanel(false)}
            onTeamChanged={refetchBoards}
          />
        </div>
      )}
      <BoardCreateModal
        isOpen={showCreateBoard}
        onClose={() => setShowCreateBoard(false)}
        onCreated={handleBoardCreated}
        projectId={projectId}
        addToast={addToast}
        boardTypes={boardTypeOptions}
      />
      {isDegradedInSimpleMode && (
        <div className="board-degraded-banner" role="status" data-testid="board-degraded-banner">
          <span className="board-degraded-banner__content">
            {t(
              "uiMode.degradedBoard",
              "This board uses an advanced workflow shape and is read-only in simple mode. Tasks keep running.",
            )}
          </span>
          {onSwitchToAdvancedMode && (
            <button
              type="button"
              className="board-degraded-banner__action"
              onClick={onSwitchToAdvancedMode}
              data-testid="board-degraded-open-advanced"
            >
              {t("uiMode.openInAdvancedEditor", "Open in advanced editor")}
            </button>
          )}
        </div>
      )}
      <main
        className="board"
        id="board"
        ref={boardRef}
        onDragStart={(e) => {
          const id = (e.target as HTMLElement)?.closest?.("[data-id]")?.getAttribute("data-id");
          if (id) draggingTaskIdRef.current = id;
        }}
        onDragEnd={() => {
          draggingTaskIdRef.current = null;
        }}
      >
        {visibleColumns.length === 0 && !loading ? (
          <div className="board-empty" data-testid="board-empty">
            {t("boardSwitcher.noColumns", "This board has no columns to show.")}
          </div>
        ) : (
          visibleColumns.map((col) => (
            <Column
              key={col.id}
              column={col.id as ColumnType}
              workflowMode
              columnDisplayName={col.name}
              columnAgentName={team[col.id]?.agentName}
              columnFlags={col.flags}
              tasks={tasksByColumn[col.id] ?? []}
              allTasks={boardTasks}
              projectId={projectId}
              maxConcurrent={maxConcurrent}
              onMoveTask={onMoveTask}
              uiMode={uiMode}
              onPromote={handlePromote}
              canDropTask={isDegradedInSimpleMode ? () => "uiMode.degradedReadOnly" : makeCanDrop(col.id)}
              getDraggingTaskId={getDraggingTaskId}
              onPauseTask={onPauseTask}
              onOpenDetail={onOpenDetail}
              onOpenGroupModal={onOpenGroupModal}
              addToast={addToast}
              globalPaused={globalPaused}
              onUpdateTask={onUpdateTask}
              onRetryTask={onRetryTask}
              onArchiveTask={onArchiveTask}
              onUnarchiveTask={onUnarchiveTask}
              onDeleteTask={onDeleteTask}
              availableModels={availableModels}
              onOpenDetailWithTab={onOpenDetailWithTab}
              favoriteProviders={favoriteProviders}
              favoriteModels={favoriteModels}
              onToggleFavorite={onToggleFavorite}
              onToggleModelFavorite={onToggleModelFavorite}
              isSearchActive={isSearchActive}
              taskStuckTimeoutMs={taskStuckTimeoutMs}
              onOpenMission={onOpenMission}
              lastFetchTimeMs={lastFetchTimeMs}
              workflowStepNameLookup={workflowStepNameLookup}
              blockerFanoutMap={blockerFanoutMap}
              prAuthAvailable={prAuthAvailable}
              autoMerge={autoMerge}
              {...(col.flags.intake ? { onQuickCreate, onNewTask, onPlanningMode, onSubtaskBreakdown } : {})}
              {...(col.flags.mergeBlocker ? { onToggleAutoMerge } : {})}
              {...(col.flags.complete ? { onArchiveAllDone } : {})}
            />
          ))
        )}
        {archivedColumn && (
          <Column
            key={archivedColumn.id}
            column={archivedColumn.id as ColumnType}
            workflowMode
            columnDisplayName={archivedColumn.name}
            columnAgentName={team[archivedColumn.id]?.agentName}
            columnFlags={archivedColumn.flags}
            tasks={tasksByColumn[archivedColumn.id] ?? []}
            allTasks={boardTasks}
            projectId={projectId}
            maxConcurrent={maxConcurrent}
            onMoveTask={onMoveTask}
            uiMode={uiMode}
            onPromote={handlePromote}
            canDropTask={isDegradedInSimpleMode ? () => "uiMode.degradedReadOnly" : makeCanDrop(archivedColumn.id)}
            getDraggingTaskId={getDraggingTaskId}
            onPauseTask={onPauseTask}
            onOpenDetail={onOpenDetail}
            onOpenGroupModal={onOpenGroupModal}
            addToast={addToast}
            globalPaused={globalPaused}
            onUpdateTask={onUpdateTask}
            onRetryTask={onRetryTask}
            onArchiveTask={onArchiveTask}
            onUnarchiveTask={onUnarchiveTask}
            onDeleteTask={onDeleteTask}
            availableModels={availableModels}
            onOpenDetailWithTab={onOpenDetailWithTab}
            favoriteProviders={favoriteProviders}
            favoriteModels={favoriteModels}
            onToggleFavorite={onToggleFavorite}
            onToggleModelFavorite={onToggleModelFavorite}
            isSearchActive={isSearchActive}
            taskStuckTimeoutMs={taskStuckTimeoutMs}
            onOpenMission={onOpenMission}
            lastFetchTimeMs={lastFetchTimeMs}
            workflowStepNameLookup={workflowStepNameLookup}
            blockerFanoutMap={blockerFanoutMap}
            prAuthAvailable={prAuthAvailable}
            autoMerge={autoMerge}
            collapsed={archivedCollapsed}
            onToggleCollapse={handleToggleArchivedCollapse}
          />
        )}
      </main>
    </>
  );
}
