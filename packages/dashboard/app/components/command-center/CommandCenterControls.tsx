import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pause, Play, Power } from "lucide-react";
import type { ColorTheme, OrgTreeNode, ThemeMode } from "@fusion/core";
import { fetchConfig, fetchExecutorStats, fetchOrgTree, fetchSettings, updateSettings } from "../../api/legacy";
import { useAppSettings } from "../../hooks/useAppSettings";
import { AgentAvatar } from "../AgentAvatar";
import { ThemeDropdown } from "../ThemeDropdown";
import "./CommandCenterControls.css";

export interface CommandCenterControlsProps {
  projectId?: string;
  colorTheme: ColorTheme;
  themeMode: ThemeMode;
  onColorThemeChange: (theme: ColorTheme) => void;
  onThemeModeChange: (mode: ThemeMode) => void;
}

type AsyncState<T> =
  | { status: "loading"; data: T | null; error: null }
  | { status: "loaded"; data: T; error: null }
  | { status: "error"; data: T | null; error: string };

type ExecutorStats = {
  globalPause: boolean;
  enginePaused: boolean;
  maxConcurrent: number;
  lastActivityAt?: string;
};

type ConcurrencyValues = {
  maxConcurrent: number;
  maxTriageConcurrent: number;
  maxWorktrees: number;
};

const EXECUTOR_STATUS_POLL_MS = 10_000;
const CONCURRENCY_SAVE_DEBOUNCE_MS = 500;
const DEFAULT_CONCURRENCY_VALUES: ConcurrencyValues = {
  maxConcurrent: 2,
  maxTriageConcurrent: 1,
  maxWorktrees: 5,
};

function formatAgentMeta(node: OrgTreeNode) {
  const title = node.agent.title?.trim();
  return title ? `${node.agent.role} · ${title}` : node.agent.role;
}

function OrgChartNode({ node }: { node: OrgTreeNode }) {
  const hasChildren = node.children.length > 0;
  return (
    <li className="cc-controls-org-item">
      <div className="org-chart-node cc-controls-org-node">
        <div className="org-chart-node__header">
          <span className="org-chart-node__icon"><AgentAvatar agent={node.agent} size={20} /></span>
          <span className="org-chart-node__name">{node.agent.name}</span>
        </div>
        <div className="org-chart-node__meta">
          <span className="org-chart-node__badge">{node.agent.state}</span>
          <span>{formatAgentMeta(node)}</span>
        </div>
      </div>
      {hasChildren ? (
        <ul className="org-chart-children cc-controls-org-children">
          {node.children.map((child) => (
            <OrgChartNode key={child.agent.id} node={child} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/*
FNXC:CommandCenter 2026-06-19-12:20:
FN-6727 makes the Command Center Overview the operator controls dashboard: org chart, heartbeat, engine, concurrency, and theme controls must live above the existing throughput and analytics surfaces without introducing new backend routes.
*/
function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatLastActivity(value: string | undefined, fallback: string) {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleString();
}

function StatusPill({ paused, label }: { paused: boolean; label: string }) {
  return (
    <span className="cc-controls-status-pill">
      <span className={`status-dot ${paused ? "status-dot--pending" : "status-dot--online"}`} aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

export function CommandCenterControls({ projectId, colorTheme, themeMode, onColorThemeChange, onThemeModeChange }: CommandCenterControlsProps) {
  const { t } = useTranslation("app");
  const {
    globalPaused,
    enginePaused,
    toggleGlobalPause,
    toggleEnginePause,
    refresh,
  } = useAppSettings(projectId);
  const [orgTreeState, setOrgTreeState] = useState<AsyncState<OrgTreeNode[]>>({ status: "loading", data: null, error: null });
  const [executorStatsState, setExecutorStatsState] = useState<AsyncState<ExecutorStats>>({ status: "loading", data: null, error: null });
  const [concurrencyState, setConcurrencyState] = useState<AsyncState<ConcurrencyValues>>({ status: "loading", data: null, error: null });
  const [concurrencyDirty, setConcurrencyDirty] = useState(false);
  const [concurrencySaveState, setConcurrencySaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  useEffect(() => {
    let cancelled = false;
    setOrgTreeState({ status: "loading", data: null, error: null });
    void (async () => {
      try {
        const result = await fetchOrgTree(projectId);
        if (!cancelled) {
          setOrgTreeState({ status: "loaded", data: result, error: null });
        }
      } catch (error) {
        if (!cancelled) {
          setOrgTreeState({
            status: "error",
            data: null,
            error: error instanceof Error ? error.message : t("commandCenter.controls.orgChart.error", "Unable to load org chart"),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, t]);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const loadExecutorStats = async () => {
      try {
        const result = await fetchExecutorStats(projectId);
        if (!cancelled) {
          setExecutorStatsState({ status: "loaded", data: result, error: null });
        }
      } catch (error) {
        if (!cancelled) {
          setExecutorStatsState({
            status: "error",
            data: null,
            error: error instanceof Error ? error.message : t("commandCenter.controls.status.error", "Unable to load live scheduler status"),
          });
        }
      } finally {
        if (!cancelled) {
          timeoutId = setTimeout(loadExecutorStats, EXECUTOR_STATUS_POLL_MS);
        }
      }
    };
    setExecutorStatsState({ status: "loading", data: null, error: null });
    void loadExecutorStats();
    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [projectId, t]);

  useEffect(() => {
    let cancelled = false;
    setConcurrencyDirty(false);
    setConcurrencySaveState("idle");
    setConcurrencyState({ status: "loading", data: null, error: null });
    void (async () => {
      try {
        const [config, settings] = await Promise.all([fetchConfig(projectId), fetchSettings(projectId)]);
        if (!cancelled) {
          setConcurrencyState({
            status: "loaded",
            data: {
              maxConcurrent: clamp(settings.maxConcurrent ?? config.maxConcurrent ?? DEFAULT_CONCURRENCY_VALUES.maxConcurrent, 1, 10),
              maxTriageConcurrent: clamp(settings.maxTriageConcurrent ?? DEFAULT_CONCURRENCY_VALUES.maxTriageConcurrent, 1, 10),
              maxWorktrees: clamp(settings.maxWorktrees ?? DEFAULT_CONCURRENCY_VALUES.maxWorktrees, 1, 20),
            },
            error: null,
          });
        }
      } catch (error) {
        if (!cancelled) {
          setConcurrencyState({
            status: "error",
            data: DEFAULT_CONCURRENCY_VALUES,
            error: error instanceof Error ? error.message : t("commandCenter.controls.concurrency.error", "Unable to load concurrency settings"),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, t]);

  useEffect(() => {
    if (!concurrencyDirty || !concurrencyState.data) return;
    const values = concurrencyState.data;
    const timeoutId = setTimeout(() => {
      setConcurrencySaveState("saving");
      void updateSettings(values, projectId)
        .then(async () => {
          await refresh();
          setConcurrencyDirty(false);
          setConcurrencySaveState("saved");
        })
        .catch(() => {
          setConcurrencySaveState("error");
        });
    }, CONCURRENCY_SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timeoutId);
  }, [concurrencyDirty, concurrencyState.data, projectId, refresh]);

  const updateConcurrencyValue = (key: keyof ConcurrencyValues, rawValue: string, min: number, max: number) => {
    const nextValue = clamp(Number(rawValue), min, max);
    setConcurrencyState((current) => ({
      status: "loaded",
      data: { ...(current.data ?? DEFAULT_CONCURRENCY_VALUES), [key]: nextValue },
      error: null,
    }));
    setConcurrencyDirty(true);
    setConcurrencySaveState("idle");
  };

  const effectiveGlobalPaused = executorStatsState.data?.globalPause ?? globalPaused;
  const effectiveEnginePaused = executorStatsState.data?.enginePaused ?? enginePaused;
  const lastActivityLabel = formatLastActivity(
    executorStatsState.data?.lastActivityAt,
    t("commandCenter.controls.status.noActivity", "No recent activity"),
  );
  const concurrencyValues = concurrencyState.data ?? DEFAULT_CONCURRENCY_VALUES;

  /*
  FNXC:CommandCenter 2026-06-19-12:35:
  The Command Center concurrency sliders mutate live scheduler limits through the existing /api/settings path; after each debounced save, refresh useAppSettings so the running dashboard reflects the new scheduler capacity without local shadow state drifting.

  FNXC:CommandCenter 2026-06-19-12:30:
  Heartbeat controls pause/resume the scheduling heartbeat via the existing enginePaused setting, while engine controls stop/start all AI work via globalPause. Both controls intentionally reuse useAppSettings toggles so Command Center does not add backend routes or competing scheduler state.
  */
  return (
    <section className="cc-controls" data-testid="command-center-controls" aria-label={t("commandCenter.controls.title", "Operator controls")}>
      <div className="cc-controls-grid">
        <section className="card cc-controls-card cc-controls-card--org" data-testid="cc-controls-org-chart">
          <div className="cc-controls-card-header">
            <div>
              <h3>{t("commandCenter.controls.orgChart.title", "Agent org chart")}</h3>
              <p>{t("commandCenter.controls.orgChart.description", "Read-only view of the running agent hierarchy.")}</p>
            </div>
          </div>
          <div className="cc-controls-org-scroll" aria-live="polite">
            {orgTreeState.status === "loading" ? (
              <p className="cc-controls-muted">{t("commandCenter.controls.orgChart.loading", "Loading org chart…")}</p>
            ) : orgTreeState.status === "error" ? (
              <p className="cc-controls-error" role="alert">{orgTreeState.error}</p>
            ) : orgTreeState.data.length === 0 ? (
              <p className="cc-controls-muted">{t("commandCenter.controls.orgChart.empty", "No agents are reporting in yet.")}</p>
            ) : (
              <ul className="cc-controls-org-roots">
                {orgTreeState.data.map((node) => (
                  <OrgChartNode key={node.agent.id} node={node} />
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="card cc-controls-card" data-testid="cc-controls-heartbeat">
          <div className="cc-controls-card-header">
            <div>
              <h3>{t("commandCenter.controls.heartbeat.title", "Heartbeat control")}</h3>
              <p>{t("commandCenter.controls.heartbeat.description", "Pause or resume the scheduling heartbeat.")}</p>
            </div>
            <StatusPill
              paused={effectiveEnginePaused}
              label={effectiveEnginePaused ? t("commandCenter.controls.status.paused", "Paused") : t("commandCenter.controls.status.running", "Running")}
            />
          </div>
          <dl className="cc-controls-facts">
            <div>
              <dt>{t("commandCenter.controls.status.lastActivity", "Last activity")}</dt>
              <dd>{executorStatsState.status === "loading" ? t("commandCenter.controls.status.loading", "Loading…") : lastActivityLabel}</dd>
            </div>
            <div>
              <dt>{t("commandCenter.controls.status.maxConcurrent", "Max concurrent")}</dt>
              <dd>{executorStatsState.data?.maxConcurrent ?? "—"}</dd>
            </div>
          </dl>
          {executorStatsState.status === "error" ? <p className="cc-controls-error" role="alert">{executorStatsState.error}</p> : null}
          <button
            type="button"
            className="btn btn-secondary cc-controls-action"
            onClick={() => void toggleEnginePause()}
            disabled={effectiveGlobalPaused}
          >
            {effectiveEnginePaused ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}
            <span>
              {effectiveEnginePaused
                ? t("commandCenter.controls.heartbeat.resume", "Resume heartbeat")
                : t("commandCenter.controls.heartbeat.pause", "Pause heartbeat")}
            </span>
          </button>
          {effectiveGlobalPaused ? (
            <p className="cc-controls-muted">{t("commandCenter.controls.heartbeat.disabledByStop", "Start the AI engine before resuming the heartbeat.")}</p>
          ) : null}
        </section>

        <section className="card cc-controls-card" data-testid="cc-controls-engine">
          <div className="cc-controls-card-header">
            <div>
              <h3>{t("commandCenter.controls.engine.title", "AI engine")}</h3>
              <p>{t("commandCenter.controls.engine.description", "Stopping the engine halts all AI work.")}</p>
            </div>
            <StatusPill
              paused={effectiveGlobalPaused}
              label={effectiveGlobalPaused ? t("commandCenter.controls.status.stopped", "Stopped") : t("commandCenter.controls.status.running", "Running")}
            />
          </div>
          <button
            type="button"
            className="btn btn-secondary cc-controls-action"
            onClick={() => void toggleGlobalPause()}
          >
            <Power size={16} aria-hidden="true" />
            <span>
              {effectiveGlobalPaused
                ? t("header.startAiEngine", "Start AI Engine")
                : t("header.stopAiEngine", "Stop AI Engine")}
            </span>
          </button>
        </section>

        <section className="card cc-controls-card" data-testid="cc-controls-theme">
          <div className="cc-controls-card-header">
            <div>
              <h3>{t("commandCenter.controls.theme.title", "Theme")}</h3>
              <p>{t("commandCenter.controls.theme.description", "Switch the dashboard theme with live color previews.")}</p>
            </div>
          </div>
          <ThemeDropdown
            colorTheme={colorTheme}
            themeMode={themeMode}
            onColorThemeChange={onColorThemeChange}
            onThemeModeChange={onThemeModeChange}
          />
        </section>

        <section className="card cc-controls-card cc-controls-card--concurrency" data-testid="cc-controls-concurrency">
          <div className="cc-controls-card-header">
            <div>
              <h3>{t("commandCenter.controls.concurrency.title", "Concurrency")}</h3>
              <p>{t("commandCenter.controls.concurrency.description", "Tune live scheduler capacity.")}</p>
            </div>
            <span className={`cc-controls-save-state cc-controls-save-state--${concurrencySaveState}`} aria-live="polite">
              {concurrencyState.status === "loading"
                ? t("commandCenter.controls.status.loading", "Loading…")
                : concurrencySaveState === "saving"
                  ? t("commandCenter.controls.status.saving", "Saving…")
                  : concurrencySaveState === "saved"
                    ? t("commandCenter.controls.status.saved", "Saved")
                    : concurrencySaveState === "error"
                      ? t("commandCenter.controls.status.saveError", "Save failed")
                      : t("commandCenter.controls.status.ready", "Ready")}
            </span>
          </div>
          <div className="cc-controls-sliders">
            <label className="cc-controls-slider" htmlFor="cc-max-concurrent">
              <span className="cc-controls-slider-label">
                {t("commandCenter.controls.concurrency.maxConcurrent", "Max concurrent tasks")}
                <strong>{concurrencyValues.maxConcurrent}</strong>
              </span>
              <input
                id="cc-max-concurrent"
                type="range"
                min={1}
                max={10}
                value={concurrencyValues.maxConcurrent}
                disabled={concurrencyState.status === "loading"}
                onChange={(event) => updateConcurrencyValue("maxConcurrent", event.target.value, 1, 10)}
              />
            </label>
            <label className="cc-controls-slider" htmlFor="cc-max-triage-concurrent">
              <span className="cc-controls-slider-label">
                {t("commandCenter.controls.concurrency.maxTriageConcurrent", "Max triage concurrent")}
                <strong>{concurrencyValues.maxTriageConcurrent}</strong>
              </span>
              <input
                id="cc-max-triage-concurrent"
                type="range"
                min={1}
                max={10}
                value={concurrencyValues.maxTriageConcurrent}
                disabled={concurrencyState.status === "loading"}
                onChange={(event) => updateConcurrencyValue("maxTriageConcurrent", event.target.value, 1, 10)}
              />
            </label>
            <label className="cc-controls-slider" htmlFor="cc-max-worktrees">
              <span className="cc-controls-slider-label">
                {t("commandCenter.controls.concurrency.maxWorktrees", "Max worktrees")}
                <strong>{concurrencyValues.maxWorktrees}</strong>
              </span>
              <input
                id="cc-max-worktrees"
                type="range"
                min={1}
                max={20}
                value={concurrencyValues.maxWorktrees}
                disabled={concurrencyState.status === "loading"}
                onChange={(event) => updateConcurrencyValue("maxWorktrees", event.target.value, 1, 20)}
              />
            </label>
          </div>
          {concurrencyState.status === "error" ? <p className="cc-controls-error" role="alert">{concurrencyState.error}</p> : null}
        </section>
      </div>
    </section>
  );
}
