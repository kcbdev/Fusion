import {
  CartesianGrid,
  Legend,
  Line,
  LineChart as RechartsLineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getCommandCenterChartColor, getCommandCenterChartTheme } from "./theme";
import "../charts.css";

export interface LineChartSeries {
  label: string;
  values: number[];
}

export interface LineChartProps {
  series: LineChartSeries[];
  ariaLabel: string;
  width?: number | string;
  height?: number | string;
  emptyLabel?: string;
  /**
   * `shared` keeps comparable values on one absolute axis. `series` normalizes each series to its own max so mixed-unit trends remain legible.
   */
  scaleMode?: "shared" | "series";
}

interface SanitizedLineChartSeries {
  label: string;
  dataKey: string;
  values: number[];
  plotKey: string;
  plotValues: number[];
}

type LineChartPoint = { index: number } & Record<string, number>;
type ResponsiveDimension = number | `${number}%`;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function sanitizeLineValue(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function normalizeSeriesValues(values: number[]): number[] {
  const max = values.reduce((largest, value) => (value > largest ? value : largest), 0);
  if (max <= 0) {
    return values.map(() => 0);
  }
  return values.map((value) => (value / max) * 100);
}

function sanitizeSeries(series: LineChartSeries[], scaleMode: LineChartProps["scaleMode"]): SanitizedLineChartSeries[] {
  return series
    .map((entry, index) => {
      const values = entry.values.map(sanitizeLineValue);
      return {
        label: entry.label,
        dataKey: `series${index}`,
        values,
        plotKey: scaleMode === "series" ? `series${index}Normalized` : `series${index}`,
        plotValues: scaleMode === "series" ? normalizeSeriesValues(values) : values,
      };
    })
    .filter((entry) => entry.values.length > 0);
}

function lineChartData(series: SanitizedLineChartSeries[]): LineChartPoint[] {
  const pointCount = series.reduce((largest, entry) => Math.max(largest, entry.values.length), 0);
  return Array.from({ length: pointCount }, (_, index) => {
    const point: LineChartPoint = { index: index + 1 };
    for (const entry of series) {
      point[entry.dataKey] = entry.values[index] ?? 0;
      point[entry.plotKey] = entry.plotValues[index] ?? 0;
    }
    return point;
  });
}

function containerStyle(width?: number | string, height?: number | string) {
  return width !== undefined || height !== undefined ? { width, height } : undefined;
}

function responsiveDimension(value: number | string | undefined): ResponsiveDimension {
  if (typeof value === "number") {
    return value;
  }

  return typeof value === "string" && /^\d+(?:\.\d+)?%$/.test(value) ? (value as `${number}%`) : "100%";
}

/**
 * FNXC:CommandCenterCharts 2026-06-18-21:52:
 * User requested real graphical pie + line charts on every Command Center surface using a proper chart library (recharts); this shared line wrapper preserves the existing series shape while coercing zero/NaN/Infinity inputs into safe responsive, token-themed, reduced-motion-aware recharts data.
 *
 * FNXC:CommandCenterCharts 2026-06-19-05:24:
 * Recharts ResponsiveContainer renders blank when its parent has no measurable block-size. Import the shared chart CSS here so every Command Center surface using this wrapper gets the token-sized default parent height even if it does not also render a hand-rolled chart primitive.
 *
 * FNXC:CommandCenterCharts 2026-06-19-07:58:
 * FN-6723 found the Activity trend still looked broken after the height/clipping fix because mixed-unit series shared one absolute axis; normalize only callers that opt into `scaleMode="series"` so low-count agent lines stay legible without changing comparable-unit charts elsewhere.
 */
export function LineChart({ series, ariaLabel, width, height, emptyLabel = "No chart data", scaleMode = "shared" }: LineChartProps) {
  const theme = getCommandCenterChartTheme();
  const chartSeries = sanitizeSeries(series, scaleMode);
  const chartData = lineChartData(chartSeries);

  if (chartSeries.length === 0 || chartData.length === 0) {
    return (
      <div className="cc-recharts-empty" role="img" aria-label={ariaLabel} style={containerStyle(width, height)}>
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="cc-recharts-chart" role="img" aria-label={ariaLabel} style={containerStyle(width, height)} data-scale-mode={scaleMode}>
      <ResponsiveContainer width={responsiveDimension(width)} height={responsiveDimension(height)}>
        <RechartsLineChart data={chartData}>
          <CartesianGrid stroke={theme.grid} />
          <XAxis dataKey="index" stroke={theme.tick} tick={{ fill: theme.tick }} />
          <YAxis
            stroke={theme.tick}
            tick={{ fill: theme.tick }}
            domain={scaleMode === "series" ? [0, 100] : undefined}
            tickFormatter={scaleMode === "series" ? (value) => `${value}%` : undefined}
          />
          <Tooltip
            contentStyle={{
              background: theme.tooltipBackground,
              borderColor: theme.tooltipBorder,
              color: theme.tooltipText,
            }}
            itemStyle={{ color: theme.tooltipText }}
            labelStyle={{ color: theme.tooltipText }}
          />
          <Legend wrapperStyle={{ color: theme.legendText }} />
          {chartSeries.map((entry, index) => (
            <Line
              key={entry.dataKey}
              type="monotone"
              dataKey={entry.plotKey}
              name={entry.label}
              stroke={getCommandCenterChartColor(index, theme)}
              isAnimationActive={!prefersReducedMotion()}
            />
          ))}
        </RechartsLineChart>
      </ResponsiveContainer>
    </div>
  );
}
