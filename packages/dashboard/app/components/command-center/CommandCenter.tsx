import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, Gauge } from "lucide-react";
import type { ActivityAnalytics, TokenAnalytics, ToolAnalytics } from "@fusion/core";
import { api } from "../../api/legacy";
import { DateRangePicker, defaultPresets, rangeFromPreset, type DateRange } from "./DateRangePicker";
import { TokensArea } from "./areas/TokensArea";
import { ToolsArea } from "./areas/ToolsArea";
import { ActivityArea } from "./areas/ActivityArea";
import { ProductivityArea } from "./areas/ProductivityArea";
import { EcosystemArea } from "./areas/EcosystemArea";
import { SignalsArea } from "./areas/SignalsArea";
import { MissionControlPanel } from "./MissionControlPanel";
import { SdlcFunnel } from "./SdlcFunnel";
import { useAnalyticsArea } from "./areas/useAnalyticsArea";
import { formatCost, formatCount, isInvalidRange, rangeQuery } from "./areas/areaShared";
import type { SignalsAnalytics } from "./areas/SignalsArea";
import "./CommandCenter.css";

type SubViewId =
  | "overview"
  | "tokens"
  | "tools"
  | "activity"
  | "productivity"
  | "ecosystem"
  | "signals"
  | "mission-control";

interface SubView {
  id: SubViewId;
  label: string;
}

function useSubViews(): SubView[] {
  const { t } = useTranslation("app");
  return [
    { id: "overview", label: t("commandCenter.tabs.overview", "Overview") },
    { id: "tokens", label: t("commandCenter.tabs.tokens", "Tokens") },
    { id: "tools", label: t("commandCenter.tabs.tools", "Tools") },
    { id: "activity", label: t("commandCenter.tabs.activity", "Activity") },
    { id: "productivity", label: t("commandCenter.tabs.productivity", "Productivity") },
    { id: "ecosystem", label: t("commandCenter.tabs.ecosystem", "Ecosystem") },
    { id: "signals", label: t("commandCenter.tabs.signals", "Signals") },
    { id: "mission-control", label: t("commandCenter.tabs.missionControl", "Mission Control") },
  ];
}

interface OverviewStatCard {
  id: string;
  label: string;
  value: string;
  subLabel?: string;
}

/*
FNXC:CommandCenter 2026-06-17-00:00:
Overview is the Command Center landing surface, so it must reflect real analytics instead of shell placeholders. Show loading while core analytics have not settled, show the empty state only after settled zero data, and treat Signals as best-effort because that endpoint can be absent without invalidating tokens/tools/activity metrics.
*/
function OverviewTab({ range }: { range: DateRange }) {
  const { t } = useTranslation("app");
  const tokens = useAnalyticsArea<TokenAnalytics>("/command-center/tokens?groupBy=model", range);
  const tools = useAnalyticsArea<ToolAnalytics>("/command-center/tools", range);
  const activity = useAnalyticsArea<ActivityAnalytics>("/command-center/activity", range);
  const [signals, setSignals] = useState<SignalsAnalytics | null>(null);
  const [signalsLoading, setSignalsLoading] = useState(true);

  const signalsQuery = rangeQuery(range);
  const invalidRange = isInvalidRange(range);

  useEffect(() => {
    if (invalidRange) {
      setSignalsLoading(false);
      setSignals(null);
      return;
    }
    let cancelled = false;
    setSignalsLoading(true);
    void (async () => {
      try {
        const result = await api<SignalsAnalytics>(`/command-center/signals${signalsQuery}`);
        if (!cancelled) {
          setSignals(result);
        }
      } catch {
        if (!cancelled) {
          setSignals(null);
        }
      } finally {
        if (!cancelled) {
          setSignalsLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [signalsQuery, invalidRange]);

  const tokenTotal = tokens.data?.totals?.totalTokens ?? 0;
  const toolCalls = tools.data?.toolCalls ?? 0;
  const activeNodes = activity.data?.activeNodes ?? 0;
  const tasksDone = activity.data?.funnel?.doneInRange ?? 0;
  const uniqueModels = tokens.data?.groups?.length ?? 0;
  const hasActivityData =
    (activity.data?.sessions ?? 0) > 0 ||
    (activity.data?.messages ?? 0) > 0 ||
    activeNodes > 0 ||
    (activity.data?.activeAgents ?? 0) > 0 ||
    tasksDone > 0;
  const hasData = tokenTotal > 0 || toolCalls > 0 || hasActivityData;
  const hasAllCoreData = tokens.data !== null && tools.data !== null && activity.data !== null;
  const isInitialLoading = !hasAllCoreData && (tokens.isLoading || tools.isLoading || activity.isLoading);
  const coreError = tokens.error ?? tools.error ?? activity.error;

  const costLabel = tokens.data ? formatCost(tokens.data.cost?.usd ?? null, tokens.data.cost?.unavailable ?? true) : "—";
  const autonomyLabel = tools.data
    ? tools.data.fullyAutonomous
      ? t("commandCenter.tools.ratioAutonomous", "{{ratio}} calls/session (fully autonomous)", {
          ratio: tools.data.autonomyRatio.toFixed(1),
        })
      : `${tools.data.autonomyRatio.toFixed(1)}:1`
    : "—";

  const cards: OverviewStatCard[] = [
    {
      id: "tokens",
      label: t("commandCenter.overview.tokensCost", "Tokens & cost"),
      value: formatCount(tokenTotal),
      subLabel: costLabel,
    },
    { id: "autonomy", label: t("commandCenter.overview.autonomy", "Autonomy ratio"), value: autonomyLabel },
    { id: "nodes", label: t("commandCenter.overview.activeNodes", "Active nodes"), value: formatCount(activeNodes) },
    { id: "tasksDone", label: t("commandCenter.overview.tasksDone", "Tasks done"), value: formatCount(tasksDone) },
    { id: "models", label: t("commandCenter.overview.uniqueModels", "Unique models"), value: formatCount(uniqueModels) },
    {
      id: "signals",
      label: t("commandCenter.overview.openSignals", "Open signals"),
      value: signalsLoading ? "—" : signals ? formatCount(signals.open ?? 0) : "—",
    },
  ];

  // The throughput funnel reads its own data (activityLog transitions) and shows
  // its own empty state, so it renders even when the stat-card aggregates have no
  // data yet.
  const throughputSection = (
    <div className="cc-overview-throughput" data-testid="command-center-throughput">
      <SdlcFunnel range={range} />
    </div>
  );

  if (isInitialLoading) {
    return (
      <div className="cc-overview">
        <div className="cc-loading" data-testid="command-center-overview-loading">
          <div className="cc-chart-skeleton" />
          <p>{t("commandCenter.loading", "Loading command center...")}</p>
        </div>
        {throughputSection}
      </div>
    );
  }

  if (coreError !== null && !hasData) {
    return (
      <div className="cc-overview">
        <div className="cc-error" data-testid="command-center-overview-error" role="alert">
          <AlertCircle size={24} />
          <p>{coreError}</p>
        </div>
        {throughputSection}
      </div>
    );
  }

  if (!hasData) {
    return (
      <div className="cc-overview">
        <div className="cc-empty" data-testid="command-center-empty">
          <Gauge size={28} />
          <p>{t("commandCenter.empty", "No usage data yet. Run some agents to populate the Command Center.")}</p>
        </div>
        {throughputSection}
      </div>
    );
  }

  return (
    <div className="cc-overview">
      <div className="cc-stat-grid">
        {cards.map((card) => (
          <div key={card.id} className="card cc-stat-card" data-testid={`command-center-stat-${card.id}`}>
            <div className="cc-stat-label">{card.label}</div>
            <div className="cc-stat-value">{card.value}</div>
            {card.subLabel ? <span className="cc-stat-sub">{card.subLabel}</span> : null}
          </div>
        ))}
      </div>
      <div className="cc-live-strip" data-testid="command-center-live-strip">
        <span className="cc-live-strip-label">{t("commandCenter.overview.liveStrip", "Live activity")}</span>
        <span className="cc-live-strip-placeholder">
          {t("commandCenter.overview.liveStripPending", "Live Mission Control loads with active sessions.")}
        </span>
      </div>
      {throughputSection}
    </div>
  );
}

function PlaceholderTab({ tabId }: { tabId: SubViewId }) {
  const { t } = useTranslation("app");
  return (
    <div className="cc-empty" data-testid={`command-center-placeholder-${tabId}`}>
      <Gauge size={28} />
      <p>{t("commandCenter.areaPending", "This area renders once metrics data is available.")}</p>
    </div>
  );
}

export function CommandCenter() {
  const { t } = useTranslation("app");
  const subViews = useSubViews();
  const [activeTab, setActiveTab] = useState<SubViewId>("overview");

  const [range, setRange] = useState<DateRange>(() => rangeFromPreset(defaultPresets((_k, f) => f)[1]));

  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const focusTab = useCallback(
    (index: number) => {
      const clamped = (index + subViews.length) % subViews.length;
      setActiveTab(subViews[clamped].id);
      tabRefs.current[clamped]?.focus();
    },
    [subViews],
  );

  const onTabKeyDown = useCallback(
    (e: React.KeyboardEvent, index: number) => {
      switch (e.key) {
        case "ArrowRight":
        case "ArrowDown":
          e.preventDefault();
          focusTab(index + 1);
          break;
        case "ArrowLeft":
        case "ArrowUp":
          e.preventDefault();
          focusTab(index - 1);
          break;
        case "Home":
          e.preventDefault();
          focusTab(0);
          break;
        case "End":
          e.preventDefault();
          focusTab(subViews.length - 1);
          break;
        case "Enter":
        case " ":
          e.preventDefault();
          setActiveTab(subViews[index].id);
          break;
        default:
          break;
      }
    },
    [focusTab, subViews],
  );

  function renderActiveTab() {
    switch (activeTab) {
      case "overview":
        return <OverviewTab range={range} />;
      case "tokens":
        return <TokensArea range={range} />;
      case "tools":
        return <ToolsArea range={range} />;
      case "activity":
        return <ActivityArea range={range} />;
      case "productivity":
        return <ProductivityArea range={range} />;
      case "ecosystem":
        return <EcosystemArea range={range} />;
      case "signals":
        return <SignalsArea range={range} />;
      case "mission-control":
        return <MissionControlPanel />;
      default:
        return <PlaceholderTab tabId={activeTab} />;
    }
  }

  return (
    <section className="command-center" data-testid="command-center">
      <header className="cc-header">
        <h2 className="cc-title">
          <Gauge size={18} />
          {t("commandCenter.heading", "Command Center")}
        </h2>
        <DateRangePicker value={range} onChange={setRange} />
      </header>

      <div
        className="cc-tablist"
        role="tablist"
        aria-label={t("commandCenter.tablistLabel", "Command Center sections")}
      >
        {subViews.map((sub, index) => {
          const selected = sub.id === activeTab;
          return (
            <button
              key={sub.id}
              ref={(el) => {
                tabRefs.current[index] = el;
              }}
              role="tab"
              id={`cc-tab-${sub.id}`}
              aria-selected={selected}
              aria-controls={`cc-tabpanel-${sub.id}`}
              tabIndex={selected ? 0 : -1}
              className={`cc-tab${selected ? " active" : ""}`}
              onClick={() => setActiveTab(sub.id)}
              onKeyDown={(e) => onTabKeyDown(e, index)}
              data-testid={`command-center-tab-${sub.id}`}
            >
              {sub.label}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`cc-tabpanel-${activeTab}`}
        aria-labelledby={`cc-tab-${activeTab}`}
        tabIndex={0}
        className="cc-tabpanel"
        data-testid={`command-center-panel-${activeTab}`}
      >
        {renderActiveTab()}
      </div>
    </section>
  );
}
