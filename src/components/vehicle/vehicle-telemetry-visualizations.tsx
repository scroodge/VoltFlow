"use client";

import { useId, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Maximize2, Minus, Plus } from "lucide-react";

import { ChartSeriesLegend, TelemetryBarChart, type BarChartModel } from "@/components/vehicle/telemetry-analytics-charts";
import { RouteMap } from "@/components/vehicle/vehicle-route-map";
import {
  ChartDataTooltip,
  CHART_LINE_GAP_MS,
  ChartHoverCrosshair,
  InteractiveChartShell,
  STD_CHART,
  DELTA_SOC_CHART,
  buildBrokenLinePaths,
  chartLineGapMs,
  clientToSvg,
  nearestIndexByX,
  nearestPointByTime,
} from "@/components/vehicle/chart-interaction";
import { formatHistoryRangeSubtitle } from "@/lib/voltflowmate/telemetry-buckets";
import type { TelemetryHistoryRange } from "@/lib/voltflowmate/telemetry-ranges";
import { MAX_TELEMETRY_CHART_POINTS, medianSampleGapSeconds } from "@/lib/voltflowmate/telemetry-ranges";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "@/hooks/use-translation";
import { calculateRegenRecoverySegments, prepareRegenRecoveryBars } from "@/lib/voltflowmate/trip-energy";
import type { Locale, TranslationKey } from "@/lib/i18n";
import type {
  VoltflowMateDiplus,
  VoltflowMateLocation,
  VoltflowMateTelemetry,
  VoltflowMateTelemetryPointRow,
  VoltflowMateTripTrackPointRow,
} from "@/types/database";
import { buildZeroAlignedAxisScales } from "./dual-axis-scale";

type Translator = (key: TranslationKey, values?: Record<string, string | number>) => string;

type ChartPoint = {
  time: number;
  value: number;
  powerKw?: number | null;
  distanceKm?: number | null;
};

type ChartSeries = {
  label: string;
  color: string;
  points: ChartPoint[];
  unit?: string;
  valueDigits?: number;
};

type ChartTier = "base" | "diagnostic";

type TelemetryChart = {
  title: string;
  unit: string;
  valueDigits: number;
  tier: ChartTier;
  series: ChartSeries[];
  minValue: number;
  maxValue: number;
  minTime: number;
  maxTime: number;
  minDistanceKm: number;
  maxDistanceKm: number;
  hasData: boolean;
  hasDistanceData: boolean;
};

type RegenRecoveryChartModel = {
  title: string;
  unit: string;
  valueDigits: number;
  xAxis: "distance" | "time";
  segments: Array<{ x: number; regenKwh: number }>;
  hasData: boolean;
};

type DeltaBySocPoint = {
  soc: number;
  delta: number;
  time: number;
};

type DeltaBySocChartModel = {
  points: DeltaBySocPoint[];
  minSoc: number;
  maxSoc: number;
  minDelta: number;
  maxDelta: number;
  latest: DeltaBySocPoint | null;
  socDirection: "charge" | "discharge";
};

type TelemetryChartSource = {
  device_time: string;
  received_at?: string;
  telemetry: VoltflowMateTelemetry;
  diplus?: VoltflowMateDiplus;
  diplus_min_cell_voltage_v?: number | null;
  diplus_max_cell_voltage_v?: number | null;
  diplus_cell_delta_v?: number | null;
  regen_kwh_sum?: number | null;
  traction_kwh_sum?: number | null;
  location?: VoltflowMateLocation;
  hourly?: {
    soc_min: number | null;
    soc_max: number | null;
  };
};

const MAX_CHART_POINTS = 240;
const MAX_TRIP_CHART_POINTS = MAX_TELEMETRY_CHART_POINTS;
const MAX_CHART_MARKERS = 80;
const MAX_DELTA_BY_SOC_POINTS = 240;
const LINE_CHART_VIEWBOX_WIDTH = 360;
const LEFT_AXIS_UNIT_X = 18;
// Keep the right labels close to the axis so the rotated unit title has its own gutter.
const RIGHT_AXIS_TICK_X = 323;
const RIGHT_AXIS_UNIT_X = 342;

function fmt(value: number | null | undefined, digits = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "—";
}

function localeCode(locale: Locale) {
  return locale === "be" ? "be-BY" : locale === "ru" ? "ru-RU" : "en-US";
}

function formatClock(ms: number) {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function validNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function validTempNumber(value: number | null | undefined) {
  const n = validNumber(value);
  return n != null && n >= -50 && n <= 90 ? n : null;
}

function pointTimeMs(point: { device_time: string; received_at?: string }) {
  const deviceMs = Date.parse(point.device_time);
  if (Number.isFinite(deviceMs)) return deviceMs;
  const receivedMs = point.received_at ? Date.parse(point.received_at) : Number.NaN;
  return Number.isFinite(receivedMs) ? receivedMs : 0;
}

function downsamplePoints<T>(points: T[], maxPoints: number) {
  if (points.length <= maxPoints) return points;
  if (maxPoints <= 1) return points.slice(0, 1);

  const lastIndex = points.length - 1;
  const sampled: T[] = [];
  let previousIndex = -1;

  for (let index = 0; index < maxPoints; index += 1) {
    const sourceIndex = Math.round((index * lastIndex) / (maxPoints - 1));
    if (sourceIndex !== previousIndex) {
      sampled.push(points[sourceIndex]);
      previousIndex = sourceIndex;
    }
  }

  return sampled;
}

function finalizeChart(chart: TelemetryChart, maxPoints = MAX_CHART_POINTS): TelemetryChart {
  const series = chart.series
    .map((item) => ({
      ...item,
      points: downsamplePoints(item.points, maxPoints),
    }))
    .filter((item) => item.points.length > 0);

  if (series.length === 0) {
    return {
      ...chart,
      series,
      hasData: false,
      minValue: 0,
      maxValue: 1,
      minTime: 0,
      maxTime: 1,
      minDistanceKm: 0,
      maxDistanceKm: 0,
      hasDistanceData: false,
    };
  }

  let minValue = Infinity;
  let maxValue = -Infinity;
  let minTime = Infinity;
  let maxTime = -Infinity;
  let minDistanceKm = Infinity;
  let maxDistanceKm = -Infinity;
  let hasDistanceData = false;

  for (const item of series) {
    for (const point of item.points) {
      minValue = Math.min(minValue, point.value);
      maxValue = Math.max(maxValue, point.value);
      minTime = Math.min(minTime, point.time);
      maxTime = Math.max(maxTime, point.time);
      if (point.distanceKm != null) {
        minDistanceKm = Math.min(minDistanceKm, point.distanceKm);
        maxDistanceKm = Math.max(maxDistanceKm, point.distanceKm);
        hasDistanceData = true;
      }
    }
  }

  return {
    ...chart,
    series,
    hasData: true,
    minValue,
    maxValue,
    minTime,
    maxTime,
    minDistanceKm: hasDistanceData ? minDistanceKm : 0,
    maxDistanceKm: hasDistanceData ? maxDistanceKm : 0,
    hasDistanceData,
  };
}

function createChart(
  title: string,
  unit: string,
  series: ChartSeries[],
  valueDigits = 1,
  tier: ChartTier = "base",
): TelemetryChart {
  return {
    title,
    unit,
    valueDigits,
    tier,
    series,
    minValue: 0,
    maxValue: 1,
    minTime: 0,
    maxTime: 1,
    minDistanceKm: 0,
    maxDistanceKm: 0,
    hasData: false,
    hasDistanceData: false,
  };
}

function addChartPoint(
  chart: TelemetryChart,
  seriesIndex: number,
  time: number,
  value: number | null,
  distanceKm?: number | null,
) {
  if (value == null || !Number.isFinite(time)) return;

  chart.series[seriesIndex].points.push({ time, value, distanceKm });
  chart.minValue = chart.hasData ? Math.min(chart.minValue, value) : value;
  chart.maxValue = chart.hasData ? Math.max(chart.maxValue, value) : value;
  chart.minTime = chart.hasData ? Math.min(chart.minTime, time) : time;
  chart.maxTime = chart.hasData ? Math.max(chart.maxTime, time) : time;
  chart.hasData = true;
}

function addDeltaBySocPoint(points: DeltaBySocPoint[], time: number, soc: number | null, delta: number | null) {
  if (soc == null || delta == null || !Number.isFinite(time)) return;
  points.push({ soc, delta, time });
}

function cellDeltaValue(point: TelemetryChartSource) {
  const columnValue = validNumber(point.diplus_cell_delta_v);
  if (columnValue != null) return columnValue;

  const telemetryValue =
    validNumber(point.telemetry.diplus_cell_delta_v) ??
    validNumber(point.telemetry.cell_delta_v);
  if (telemetryValue != null) return telemetryValue;

  const rawValue = validNumber(point.diplus?.cell_delta_v);
  if (rawValue != null) return rawValue;

  const min = validNumber(point.diplus_min_cell_voltage_v) ??
    validNumber(point.telemetry.diplus_min_cell_voltage_v) ??
    validNumber(point.telemetry.cell_voltage_min_v) ??
    validNumber(point.diplus?.min_cell_voltage_v);
  const max = validNumber(point.diplus_max_cell_voltage_v) ??
    validNumber(point.telemetry.diplus_max_cell_voltage_v) ??
    validNumber(point.telemetry.cell_voltage_max_v) ??
    validNumber(point.diplus?.max_cell_voltage_v);

  return min != null && max != null ? max - min : null;
}

function prepareDeltaBySoc(
  points: DeltaBySocPoint[],
  socDirection: DeltaBySocChartModel["socDirection"],
): DeltaBySocChartModel {
  const sampled = downsamplePoints(points, MAX_DELTA_BY_SOC_POINTS);
  if (sampled.length === 0) {
    return {
      points: [],
      minSoc: 0,
      maxSoc: 100,
      minDelta: 0,
      maxDelta: 1,
      latest: null,
      socDirection,
    };
  }

  return {
    points: sampled,
    minSoc: Math.min(...sampled.map((point) => point.soc)),
    maxSoc: Math.max(...sampled.map((point) => point.soc)),
    minDelta: Math.min(...sampled.map((point) => point.delta)),
    maxDelta: Math.max(...sampled.map((point) => point.delta)),
    latest: sampled.at(-1) ?? null,
    socDirection,
  };
}

/** Mate trip samples are sparse; default line-gap logic splits every segment. */
function deltaBySocTripLineGapMs(
  points: DeltaBySocPoint[],
  fallbackGapMs: number,
) {
  if (points.length < 2) return fallbackGapMs;
  const minTime = Math.min(...points.map((point) => point.time));
  const maxTime = Math.max(...points.map((point) => point.time));
  if (maxTime <= minTime) return fallbackGapMs;
  const avgGapMs = (maxTime - minTime) / (points.length - 1);
  return Math.max(fallbackGapMs, avgGapMs * 2.5);
}

function prepareTelemetryHistory(
  points: TelemetryChartSource[],
  t: Translator,
  options?: { includeCellDelta?: boolean; maxChartPoints?: number },
) {
  const includeCellDelta = options?.includeCellDelta !== false;
  const maxChartPoints = options?.maxChartPoints ?? MAX_CHART_POINTS;
  const socChart = createChart(t("vehicle.charts.soc"), "%", [
    { label: "SOC", color: "var(--voltflow-cyan)", points: [] },
  ], 1, "base");
  const speedPowerChart = createChart(t("vehicle.charts.speedPower"), "", [
    {
      label: t("vehicle.metrics.speed"),
      color: "#7dd3fc",
      points: [],
      unit: "km/h",
      valueDigits: 0,
    },
    {
      label: t("vehicle.metrics.power"),
      color: "#facc15",
      points: [],
      unit: "kW",
      valueDigits: 1,
    },
  ], 1, "base");
  const temperatureChart = createChart(t("vehicle.charts.temperatures"), "°C", [
    { label: t("vehicle.charts.battery"), color: "#22c55e", points: [] },
    { label: t("vehicle.charts.outside"), color: "#38bdf8", points: [] },
    { label: t("vehicle.charts.cabin"), color: "#fb7185", points: [] },
  ], 1, "diagnostic");
  const cellDeltaChart = createChart(t("vehicle.charts.cellDelta"), "V", [
    { label: "Delta", color: "#fb7185", points: [] },
  ], 3, "diagnostic");
  const deltaBySocPoints: DeltaBySocPoint[] = [];
  let hasCellDeltaData = false;

  let visiblePointCount = 0;
  let start: string | undefined;
  let end: string | undefined;
  const deviceTimes: string[] = [];
  // Distance tracking: use current_trip_distance_km if available, else odometer delta
  const firstOdometerKm = validNumber(
    points.find((point) => point.telemetry?.odometer_km != null)?.telemetry?.odometer_km,
  );

  for (const point of points) {
    if (!point.telemetry) continue;

    visiblePointCount += 1;
    start ??= point.device_time;
    end = point.device_time;
    deviceTimes.push(point.device_time);

    const time = pointTimeMs(point);
    const soc = validNumber(point.telemetry.soc);
    const cellDelta = cellDeltaValue(point);

    // Prefer current_trip_distance_km; fall back to odometer delta from first sample
    const tripDistKm = validNumber(point.telemetry.current_trip_distance_km);
    const odometerKm = validNumber(point.telemetry.odometer_km);
    const distanceKm =
      tripDistKm ??
      (firstOdometerKm != null && odometerKm != null
        ? Math.max(0, odometerKm - firstOdometerKm)
        : null);

    addChartPoint(socChart, 0, time, soc, distanceKm);
    addChartPoint(speedPowerChart, 0, time, validNumber(point.telemetry.speed_kmh), distanceKm);
    addChartPoint(speedPowerChart, 1, time, validNumber(point.telemetry.power_kw), distanceKm);
    addChartPoint(temperatureChart, 0, time, validTempNumber(point.telemetry.battery_temp_c), distanceKm);
    addChartPoint(temperatureChart, 1, time, validTempNumber(point.telemetry.outside_temp_c), distanceKm);
    addChartPoint(temperatureChart, 2, time, validTempNumber(point.telemetry.cabin_temp_c), distanceKm);
    if (includeCellDelta) {
      addChartPoint(cellDeltaChart, 0, time, cellDelta, distanceKm);
      addDeltaBySocPoint(deltaBySocPoints, time, soc, cellDelta);
      if (cellDelta != null) hasCellDeltaData = true;
    }
  }

  const hourlyRegen = points.some((point) => typeof point.regen_kwh_sum === "number");
  let regenRecoverySegments;
  if (hourlyRegen) {
    const startOdometerKm = validNumber(points[0]?.telemetry?.odometer_km);
    regenRecoverySegments = points
      .map((point) => {
        const regenKwh = point.regen_kwh_sum ?? 0;
        if (regenKwh <= 0) return null;
        const tripDistance = validNumber(point.telemetry?.current_trip_distance_km);
        const odometerKm = validNumber(point.telemetry?.odometer_km);
        const distanceKm =
          tripDistance ??
          (startOdometerKm != null && odometerKm != null ? Math.max(0, odometerKm - startOdometerKm) : null);
        return {
          time: pointTimeMs(point),
          distanceKm,
          regenKwh,
          powerKw: validNumber(point.telemetry?.power_kw),
        };
      })
      .filter((segment): segment is NonNullable<typeof segment> => segment != null);
  } else {
    regenRecoverySegments = calculateRegenRecoverySegments(
      points.map((sample) => ({
        device_time: sample.device_time,
        power_kw: sample.telemetry?.power_kw,
        current_trip_distance_km: sample.telemetry?.current_trip_distance_km,
        odometer_km: sample.telemetry?.odometer_km,
      })),
    );
  }

  const regenBars = prepareRegenRecoveryBars(regenRecoverySegments);
  const regenRecoveryChart: RegenRecoveryChartModel = {
    title: t("vehicle.charts.regen"),
    unit: "kWh",
    valueDigits: 2,
    xAxis: regenBars.xAxis,
    segments: regenBars.segments,
    hasData: regenBars.hasData,
  };

  const includesCellDeltaChart = includeCellDelta && hasCellDeltaData;
  const charts = [
    socChart,
    speedPowerChart,
    temperatureChart,
    // Cell Delta time-series removed — Delta by SOC below captures the same signal more usefully
  ].map((chart) => finalizeChart(chart, maxChartPoints));

  let minTime = Infinity;
  let maxTime = -Infinity;
  let hasData = false;
  for (const chart of charts) {
    if (!chart.hasData) continue;
    hasData = true;
    minTime = Math.min(minTime, chart.minTime);
    maxTime = Math.max(maxTime, chart.maxTime);
  }

  return {
    visiblePointCount,
    medianGapSeconds: medianSampleGapSeconds(deviceTimes),
    start,
    end,
    minTime: hasData ? minTime : 0,
    maxTime: hasData ? maxTime : 1,
    hasData,
    charts,
    regenRecoveryChart,
    deltaBySoc: includesCellDeltaChart
      ? prepareDeltaBySoc(deltaBySocPoints, "discharge")
      : { points: [], minSoc: 0, maxSoc: 100, minDelta: 0, maxDelta: 0, latest: null, socDirection: "discharge" as const },
  };
}

export function TelemetryHistoryCharts({
  points,
  isLoading,
  hasError,
  embedded = false,
  chartMode = "trip",
  historyRange,
  anchorDate,
  barCharts,
  mapPoints,
  trackPoints,
}: {
  points: TelemetryChartSource[];
  isLoading: boolean;
  hasError: boolean;
  embedded?: boolean;
  chartMode?: "trip" | "analytics";
  historyRange?: TelemetryHistoryRange;
  anchorDate?: string;
  barCharts?: BarChartModel[];
  mapPoints?: VoltflowMateTelemetryPointRow[];
  trackPoints?: VoltflowMateTripTrackPointRow[];
}) {
  const { locale, t } = useTranslation();
  const tx = t as Translator;
  const [tripXAxis, setTripXAxis] = useState<"time" | "distance">("time");
  const includeCellDelta = chartMode === "trip";
  const isAnalyticsDay = chartMode === "analytics" && historyRange === "day";
  const maxChartPoints =
    chartMode === "trip" || isAnalyticsDay ? MAX_TRIP_CHART_POINTS : MAX_CHART_POINTS;
  const history = useMemo(
    () => prepareTelemetryHistory(points, tx, { includeCellDelta, maxChartPoints }),
    [points, tx, includeCellDelta, maxChartPoints],
  );
  const lineGapMs = useMemo(
    () =>
      chartLineGapMs(
        history.medianGapSeconds,
        history.hasData ? history.minTime : undefined,
        history.hasData ? history.maxTime : undefined,
        history.visiblePointCount,
      ),
    [history.medianGapSeconds, history.minTime, history.maxTime, history.visiblePointCount, history.hasData],
  );
  const historyHasDistanceData = history.charts.some((c) => c.hasDistanceData);
  const showLineCharts =
    chartMode === "trip" ||
    (chartMode === "analytics" && historyRange === "day");
  const showBarCharts =
    chartMode === "analytics" && historyRange != null && historyRange !== "day" && (barCharts?.length ?? 0) > 0;

  const titleKey =
    chartMode === "trip" ? "vehicle.charts.title" : "vehicle.analytics.telemetryChartsTitle";

  const rangeSubtitle =
    chartMode === "analytics" && historyRange && anchorDate
      ? formatHistoryRangeSubtitle(historyRange, anchorDate, localeCode(locale))
      : null;
  const medianGapLabel =
    history.medianGapSeconds != null
      ? tx("vehicle.charts.medianGap", { value: history.medianGapSeconds.toFixed(1) })
      : null;

  const pointsLabel = tx("vehicle.charts.cloudPoints", { value: history.visiblePointCount });
  const subtitleParts = [
    rangeSubtitle,
    pointsLabel,
    medianGapLabel,
    history.start && history.end && showLineCharts
      ? `${new Date(history.start).toLocaleTimeString(localeCode(locale))} - ${new Date(history.end).toLocaleTimeString(localeCode(locale))}`
      : null,
  ].filter(Boolean);

  const subtitle = subtitleParts.join(" · ");

  return (
    <section className={embedded ? "rounded-2xl border border-border bg-white/[0.02] p-4" : "voltflow-card p-5"}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight">
            {tx(titleKey)}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <span className="rounded-full border border-border bg-white/[0.03] px-3 py-1 text-xs uppercase tracking-[0.18em] text-muted-foreground">
          {tx("vehicle.charts.refresh")}
        </span>
      </div>

      {isLoading ? (
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-52 rounded-2xl" />
          ))}
        </div>
      ) : hasError ? (
        <p className="mt-5 rounded-2xl border border-border bg-white/[0.03] p-4 text-sm text-muted-foreground">
          {tx("vehicle.errors.history")}
        </p>
      ) : history.visiblePointCount === 0 && !showBarCharts ? (
        <p className="mt-5 rounded-2xl border border-border bg-white/[0.03] p-4 text-sm text-muted-foreground">
          {tx("vehicle.charts.empty")}
        </p>
      ) : (
        <>
          {chartMode === "trip" && historyHasDistanceData && showLineCharts ? (
            <div className="mt-4 flex items-center gap-1.5">
              <button
                className={`rounded-full border px-3 py-1 text-xs font-medium transition ${tripXAxis === "time" ? "border-primary bg-primary/10 text-primary" : "border-border bg-white/[0.02] text-muted-foreground hover:border-primary/40 hover:text-foreground"}`}
                onClick={() => setTripXAxis("time")}
              >
                ⏱ {tx("vehicle.charts.elapsed")}
              </button>
              <button
                className={`rounded-full border px-3 py-1 text-xs font-medium transition ${tripXAxis === "distance" ? "border-primary bg-primary/10 text-primary" : "border-border bg-white/[0.02] text-muted-foreground hover:border-primary/40 hover:text-foreground"}`}
                onClick={() => setTripXAxis("distance")}
              >
                ↔ km
              </button>
            </div>
          ) : null}
          {showLineCharts && history.visiblePointCount > 0 && history.visiblePointCount < 2 ? (
            <p className="mt-5 rounded-2xl border border-primary/20 bg-primary/10 p-4 text-sm text-primary">
              {tx("vehicle.charts.onePoint")}
            </p>
          ) : null}
          {showLineCharts && history.visiblePointCount > 0 ? (
            <>
              {/* Base charts — always visible */}
              <div className="mt-5 grid gap-3 md:grid-cols-2">
                {history.charts
                  .filter((c) => c.tier === "base")
                  .map((chart) => (
                    <TelemetryLineChart
                      key={chart.title}
                      chart={chart}
                      lineGapMs={lineGapMs}
                      xAxis={chartMode === "trip" ? tripXAxis : "time"}
                      mapPoints={chartMode === "trip" ? mapPoints : undefined}
                      trackPoints={chartMode === "trip" ? trackPoints : undefined}
                    />
                  ))}
              </div>
              {/* Diagnostic charts — collapsed by default */}
              {(() => {
                const diagnosticCharts = history.charts.filter((c) => c.tier === "diagnostic" && c.hasData);
                const hasDiagnostic =
                  diagnosticCharts.length > 0 ||
                  history.regenRecoveryChart.hasData ||
                  history.deltaBySoc.points.length > 0;
                if (!hasDiagnostic) return null;
                return (
                  <details className="mt-3 group">
                    <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl border border-border bg-white/[0.02] px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground transition hover:border-primary/40 hover:text-foreground">
                      <span className="transition-transform group-open:rotate-90">›</span>
                      {tx("vehicle.charts.diagnosticsLabel")}
                    </summary>
                    <div className="mt-2 grid gap-3 md:grid-cols-2">
                      {diagnosticCharts.map((chart) => (
                        <TelemetryLineChart
                          key={chart.title}
                          chart={chart}
                          lineGapMs={lineGapMs}
                          mapPoints={chartMode === "trip" ? mapPoints : undefined}
                          trackPoints={chartMode === "trip" ? trackPoints : undefined}
                        />
                      ))}
                      {history.regenRecoveryChart.hasData ? (
                        <RegenRecoveryChart chart={history.regenRecoveryChart} />
                      ) : null}
                    </div>
                    {history.deltaBySoc.points.length > 0 ? (
                      <DeltaBySocChart chart={history.deltaBySoc} lineGapMs={lineGapMs} />
                    ) : null}
                  </details>
                );
              })()}
            </>
          ) : null}
          {showBarCharts ? (
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {barCharts!.map((chart) => (
                <TelemetryBarChart key={chart.title} chart={chart} />
              ))}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function seriesUnit(item: ChartSeries, chartUnit: string) {
  return item.unit ?? chartUnit;
}

function chartUsesDualAxis(series: ChartSeries[], chartUnit: string) {
  const units = series.map((item) => seriesUnit(item, chartUnit));
  return new Set(units).size > 1;
}

function formatChartRange(
  series: ChartSeries[],
  chartUnit: string,
  chartValueDigits: number,
  tx: Translator,
) {
  if (!series.length) return tx("vehicle.charts.noValues");

  return series
    .map((item) => {
      const values = item.points.map((point) => point.value);
      if (values.length === 0) return null;
      const digits = item.valueDigits ?? chartValueDigits;
      const unit = seriesUnit(item, chartUnit);
      const minValue = Math.min(...values);
      const maxValue = Math.max(...values);
      return `${fmt(minValue, digits)}-${fmt(maxValue, digits)}${unit ? ` ${unit}` : ""}`;
    })
    .filter(Boolean)
    .join(" · ");
}

function formatRegenRecoveryXLabel(xAxis: "distance" | "time", value: number) {
  if (xAxis === "distance") return `${fmt(value, 1)} km`;
  return formatClock(value);
}

function RegenRecoveryChart({ chart }: { chart: RegenRecoveryChartModel }) {
  const { t } = useTranslation();
  const tx = t as Translator;
  const [isOpen, setIsOpen] = useState(false);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const { title, unit, valueDigits, xAxis, segments, hasData } = chart;
  const regenColor = "#34d399";
  const totalRegen = segments.reduce((sum, segment) => sum + segment.regenKwh, 0);
  const maxRegen = segments.length ? Math.max(...segments.map((segment) => segment.regenKwh)) : 1;
  const minX = segments.length ? Math.min(...segments.map((segment) => segment.x)) : 0;
  const maxX = segments.length ? Math.max(...segments.map((segment) => segment.x)) : 1;
  const xPad =
    xAxis === "distance"
      ? Math.max((maxX - minX) * 0.04, 0.1)
      : Math.max((maxX - minX) * 0.04, 60_000);
  const plotMinX = minX - xPad;
  const plotMaxX = maxX + xPad;
  const yMin = 0;
  const yMax = Math.max(maxRegen * 1.12, 0.01);

  const xScale = (value: number) => {
    if (plotMaxX === plotMinX) return 160;
    return 34 + ((value - plotMinX) / (plotMaxX - plotMinX)) * 284;
  };
  const yScale = (value: number) => {
    if (yMax === yMin) return 104;
    return 104 - ((value - yMin) / (yMax - yMin)) * 88;
  };

  const xAxisLabel =
    xAxis === "distance"
      ? tx("vehicle.charts.regenAxisDistance" as TranslationKey)
      : tx("vehicle.charts.regenAxisTime" as TranslationKey);
  const rangeLabel = hasData
    ? `${fmt(totalRegen, valueDigits)} ${unit} ${tx("vehicle.charts.regenTotal" as TranslationKey)} · ${xAxisLabel}`
    : tx("vehicle.charts.noValues");

  const xTicks = hasData
    ? [
        { x: minX, label: formatRegenRecoveryXLabel(xAxis, minX) },
        { x: minX + (maxX - minX) / 2, label: formatRegenRecoveryXLabel(xAxis, minX + (maxX - minX) / 2) },
        { x: maxX, label: formatRegenRecoveryXLabel(xAxis, maxX) },
      ]
    : [];
  const yTicks = hasData
    ? [
        { label: fmt(yMax, valueDigits), value: yMax },
        { label: fmt(yMax / 2, valueDigits), value: yMax / 2 },
        { label: fmt(yMin, valueDigits), value: yMin },
      ]
    : [];
  const barWidth = segments.length
    ? Math.min(10, Math.max(3, (284 / Math.max(segments.length, 1)) * 0.7))
    : 4;
  const hoveredSegment = hoverIndex == null ? null : segments[hoverIndex] ?? null;

  const plot = (heightClass: string, interactive = false) => {
    const handleMouseMove = (event: React.MouseEvent<SVGSVGElement>) => {
      const pointer = clientToSvg(event.currentTarget, event.clientX, event.clientY, STD_CHART.width, STD_CHART.height);
      if (pointer.x < STD_CHART.plotLeft || pointer.x > STD_CHART.plotRight) {
        setHoverIndex(null);
        return;
      }
      const xPositions = segments.map((segment) => xScale(segment.x));
      setHoverIndex(nearestIndexByX(pointer.x, xPositions));
    };

    const svg = (
      <svg
        className={interactive ? "size-full overflow-visible" : `${heightClass} w-full overflow-visible`}
        viewBox={`0 0 ${STD_CHART.width} ${STD_CHART.height}`}
        role="img"
        aria-label={tx("vehicle.charts.chartAria", { title })}
        onMouseMove={interactive ? handleMouseMove : undefined}
        onMouseLeave={interactive ? () => setHoverIndex(null) : undefined}
      >
      <line x1="34" x2="318" y1="104" y2="104" stroke="currentColor" className="text-border" strokeWidth="1" />
      <line x1="34" x2="34" y1="16" y2="104" stroke="currentColor" className="text-border" strokeWidth="1" />
      {yTicks.map((tick, index) => (
        <g key={`${title}-y-${index}`}>
          <line x1="34" x2="318" y1={yScale(tick.value)} y2={yScale(tick.value)} stroke="currentColor" className="text-border/60" strokeWidth="1" strokeDasharray="4 6" />
          <text x="29" y={yScale(tick.value) + 3} textAnchor="end" className="fill-muted-foreground text-[9px]">
            {tick.label}
          </text>
        </g>
      ))}
      {xTicks.map((tick, index) => (
        <g key={`${title}-x-${index}`}>
          <line x1={xScale(tick.x)} x2={xScale(tick.x)} y1="104" y2="109" stroke="currentColor" className="text-border" strokeWidth="1" />
          <text x={xScale(tick.x)} y="124" textAnchor="middle" className="fill-muted-foreground text-[9px]">
            {tick.label}
          </text>
        </g>
      ))}
      <text x="176" y="148" textAnchor="middle" className="fill-muted-foreground text-[9px]">
        {xAxisLabel}
      </text>
      <text x="6" y="60" textAnchor="middle" transform="rotate(-90 6 60)" className="fill-muted-foreground text-[9px]">
        {unit}
      </text>
      {segments.map((segment, index) => {
        const cx = xScale(segment.x);
        const baseline = yScale(yMin);
        const top = yScale(segment.regenKwh);
        const height = Math.max(0, baseline - top);
        const tooltip = `${formatRegenRecoveryXLabel(xAxis, segment.x)}\n${fmt(segment.regenKwh, valueDigits)} ${unit}`;
        const highlighted = interactive && hoverIndex === index;
        return (
          <g key={`${segment.x}-${index}`}>
            <rect
              x={cx - barWidth / 2}
              y={top}
              width={barWidth}
              height={height}
              rx="2"
              fill={regenColor}
              fillOpacity={highlighted ? 1 : 0.85}
              stroke={highlighted ? "#ffffff" : "none"}
              strokeWidth={highlighted ? 1.5 : 0}
            >
              {!interactive ? <title>{tooltip}</title> : null}
            </rect>
            {height >= 12 ? (
              <text x={cx} y={top - 3} textAnchor="middle" className="fill-foreground text-[7px] font-medium">
                {fmt(segment.regenKwh, valueDigits)}
              </text>
            ) : null}
          </g>
        );
      })}
      {interactive && hoveredSegment ? (
        <ChartHoverCrosshair
          snapX={xScale(hoveredSegment.x)}
          plotTop={STD_CHART.plotTop}
          plotBottom={STD_CHART.plotBottom}
        />
      ) : null}
      </svg>
    );

    return (
      <InteractiveChartShell
        heightClass={heightClass}
        interactive={interactive}
        tooltip={
          hoveredSegment ? (
            <ChartDataTooltip
              title={formatRegenRecoveryXLabel(xAxis, hoveredSegment.x)}
              rows={[{ label: tx("vehicle.trips.regen"), value: `${fmt(hoveredSegment.regenKwh, valueDigits)} ${unit}`, color: regenColor }]}
              viewBoxX={xScale(hoveredSegment.x)}
              viewBoxY={STD_CHART.plotTop + 8}
              viewBoxWidth={LINE_CHART_VIEWBOX_WIDTH}
              viewBoxHeight={STD_CHART.height}
            />
          ) : null
        }
      >
        {svg}
      </InteractiveChartShell>
    );
  };

  return (
    <article className="rounded-2xl border border-border bg-white/[0.02] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-heading text-lg font-semibold tracking-tight">{title}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{rangeLabel}</p>
        </div>
        <div className="flex shrink-0 items-center">
          <IconButton label={tx("vehicle.charts.fullscreen")} onClick={() => setIsOpen(true)}>
            <Maximize2 className="size-4" aria-hidden />
          </IconButton>
        </div>
      </div>

      <div className="mt-4">{plot("h-44")}</div>

      <Dialog
        open={isOpen}
        onOpenChange={(open) => {
          setIsOpen(open);
          if (!open) setHoverIndex(null);
        }}
      >
        <DialogContent className="h-[calc(100dvh-1rem)] max-w-[calc(100vw-1rem)] content-start gap-3 overflow-y-auto p-3 sm:max-w-[calc(100vw-2rem)]">
          <DialogTitle className="sr-only">{title}</DialogTitle>
          <div className="px-1">
            <h3 className="font-heading text-xl font-semibold tracking-tight">{title}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{rangeLabel}</p>
          </div>
          {plot("h-[60dvh]", true)}
        </DialogContent>
      </Dialog>
    </article>
  );
}

function TelemetryLineChart({
  chart,
  lineGapMs = CHART_LINE_GAP_MS,
  xAxis = "time",
  mapPoints,
  trackPoints,
}: {
  chart: TelemetryChart;
  lineGapMs?: number;
  xAxis?: "time" | "distance";
  mapPoints?: VoltflowMateTelemetryPointRow[];
  trackPoints?: VoltflowMateTripTrackPointRow[];
}) {
  const { t } = useTranslation();
  const tx = t as Translator;
  const [isOpen, setIsOpen] = useState(false);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [timeZoom, setTimeZoom] = useState(0);
  const {
    title,
    unit,
    valueDigits,
    series: fullSeries,
    hasData: fullHasData,
    minValue: fullMinValue,
    maxValue: fullMaxValue,
    minTime: fullMinTime,
    maxTime: fullMaxTime,
    minDistanceKm,
    maxDistanceKm,
  } = chart;
  // Fall back to time axis if no distance data available
  const activeXAxis = xAxis === "distance" && chart.hasDistanceData ? "distance" : "time";
  const zoomCenter = hoverTime ?? fullMinTime + (fullMaxTime - fullMinTime) / 2;
  const fullDuration = Math.max(1, fullMaxTime - fullMinTime);
  const visibleDuration = fullDuration / 2 ** timeZoom;
  const unclampedMinTime = zoomCenter - visibleDuration / 2;
  const minTime = Math.max(fullMinTime, Math.min(unclampedMinTime, fullMaxTime - visibleDuration));
  const maxTime = Math.min(fullMaxTime, minTime + visibleDuration);
  const series = useMemo(
    () =>
      timeZoom === 0 || activeXAxis === "distance"
        ? fullSeries
        : fullSeries.map((item) => ({
            ...item,
            points: item.points.filter((point) => point.time >= minTime && point.time <= maxTime),
          })),
    [activeXAxis, fullSeries, maxTime, minTime, timeZoom],
  );
  const visibleValues = series.flatMap((item) => item.points.map((point) => point.value));
  const hasData = fullHasData && visibleValues.length > 0;
  const minValue = visibleValues.length > 0 ? Math.min(...visibleValues) : fullMinValue;
  const maxValue = visibleValues.length > 0 ? Math.max(...visibleValues) : fullMaxValue;
  const dualAxis = chartUsesDualAxis(series, unit);
  const valuePad = Math.max((maxValue - minValue) * 0.12, maxValue === minValue ? 1 : 0);
  const yMin = minValue - valuePad;
  const yMax = maxValue + valuePad;
  const singleY = (value: number) => {
    if (yMax === yMin) return 60;
    return 104 - ((value - yMin) / (yMax - yMin)) * 88;
  };
  const seriesScales = dualAxis
    ? buildZeroAlignedAxisScales(series.map((item) => item.points.map((point) => point.value))).map(
        (scale, seriesIndex) => ({
          ...scale,
          yTicks: scale.yTickValues.map((value) => ({
            label: fmt(value, series[seriesIndex].valueDigits ?? valueDigits),
            value,
          })),
        }),
      )
    : [];
  const rangeLabel = formatChartRange(series, unit, valueDigits, tx);
  const chartTimes = useMemo(
    () => [...new Set(series.flatMap((item) => item.points.map((point) => point.time)))].sort((a, b) => a - b),
    [series],
  );
  // Parallel distance array for chartTimes (used when activeXAxis === "distance")
  const chartTimeDistances = useMemo<(number | null)[] | null>(() => {
    if (activeXAxis !== "distance") return null;
    const map = new Map<number, number>();
    for (const item of series) {
      for (const point of item.points) {
        if (point.distanceKm != null) map.set(point.time, point.distanceKm);
      }
    }
    return chartTimes.map((t) => map.get(t) ?? null);
  }, [activeXAxis, series, chartTimes]);

  // X-axis: time mode uses point.time; distance mode uses point.distanceKm
  const x = (timeOrDist: number) => {
    if (activeXAxis === "distance") {
      if (maxDistanceKm === minDistanceKm) return 160;
      return 34 + ((timeOrDist - minDistanceKm) / (maxDistanceKm - minDistanceKm)) * 284;
    }
    if (maxTime === minTime) return 160;
    return 34 + ((timeOrDist - minTime) / (maxTime - minTime)) * 284;
  };
  const y = (seriesIndex: number, value: number) =>
    dualAxis ? seriesScales[seriesIndex].y(value) : singleY(value);
  const startTime = Number.isFinite(minTime) ? minTime : 0;
  // X-axis ticks: time labels or distance labels
  const xTicks = hasData
    ? activeXAxis === "distance"
      ? [
          { label: `${fmt(minDistanceKm, 1)} km`, xVal: minDistanceKm },
          { label: `${fmt((minDistanceKm + maxDistanceKm) / 2, 1)} km`, xVal: (minDistanceKm + maxDistanceKm) / 2 },
          { label: `${fmt(maxDistanceKm, 1)} km`, xVal: maxDistanceKm },
        ]
      : [
          { label: new Date(minTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), xVal: minTime },
          {
            label: new Date(minTime + (maxTime - minTime) / 2).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            xVal: minTime + (maxTime - minTime) / 2,
          },
          { label: new Date(maxTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), xVal: maxTime },
        ]
    : [];
  const xAxisLabel = activeXAxis === "distance" ? "km" : tx("vehicle.charts.elapsed");
  // Get SVG X coordinate for a chart point (uses distanceKm in distance mode)
  const xCoord = (point: ChartPoint) =>
    activeXAxis === "distance" && point.distanceKm != null ? x(point.distanceKm) : x(point.time);
  const singleYTicks = hasData
    ? [
        { label: fmt(maxValue, valueDigits), value: maxValue },
        { label: fmt((minValue + maxValue) / 2, valueDigits), value: (minValue + maxValue) / 2 },
        { label: fmt(minValue, valueDigits), value: minValue },
      ]
    : [];

  const pointTitle = (item: ChartSeries, point: ChartPoint) => {
    const elapsedMin = Math.max(0, Math.round((point.time - startTime) / 60000));
    const clock = new Date(point.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const digits = item.valueDigits ?? valueDigits;
    const pointUnit = seriesUnit(item, unit);
    const power = point.powerKw == null ? "" : `\n${tx("vehicle.metrics.power")}: ${fmt(point.powerKw, 1)} kW`;
    return `${item.label}: ${fmt(point.value, digits)}${pointUnit ? ` ${pointUnit}` : ""}\n${elapsedMin}m · ${clock}${power}`;
  };

  const hoverRows =
    hoverTime == null
      ? []
      : series
          .map((item, seriesIndex) => {
            const point = nearestPointByTime(item.points, hoverTime);
            if (!point) return null;
            const digits = item.valueDigits ?? valueDigits;
            const pointUnit = seriesUnit(item, unit);
            return {
              label: item.label,
              value: `${fmt(point.value, digits)}${pointUnit ? ` ${pointUnit}` : ""}`,
              color: item.color,
              y: y(seriesIndex, point.value),
            };
          })
          .filter((row): row is NonNullable<typeof row> => row != null);

  const plot = (heightClass: string, interactive = false) => {
    const updateSelectedTime = (element: SVGSVGElement, clientX: number, clientY: number) => {
      const pointer = clientToSvg(element, clientX, clientY, LINE_CHART_VIEWBOX_WIDTH, STD_CHART.height);
      if (pointer.x < STD_CHART.plotLeft || pointer.x > STD_CHART.plotRight || chartTimes.length === 0) {
        setHoverTime(null);
        return;
      }
      const xPositions = chartTimes.map((time, i) =>
        activeXAxis === "distance" && chartTimeDistances
          ? (chartTimeDistances[i] != null ? x(chartTimeDistances[i]!) : x(time))
          : x(time),
      );
      const index = nearestIndexByX(pointer.x, xPositions);
      setHoverTime(chartTimes[index] ?? null);
    };
    const handleKeyDown = (event: React.KeyboardEvent<SVGSVGElement>) => {
      if (!interactive || chartTimes.length === 0) return;
      const currentIndex = hoverTime == null ? 0 : Math.max(0, chartTimes.indexOf(hoverTime));
      let nextIndex = currentIndex;
      if (event.key === "ArrowLeft") nextIndex = Math.max(0, currentIndex - 1);
      else if (event.key === "ArrowRight") nextIndex = Math.min(chartTimes.length - 1, currentIndex + 1);
      else if (event.key === "Home") nextIndex = 0;
      else if (event.key === "End") nextIndex = chartTimes.length - 1;
      else return;
      event.preventDefault();
      setHoverTime(chartTimes[nextIndex] ?? null);
    };

    // Hover X position in SVG coords — distance mode uses mapped distanceKm
    const hoverX =
      hoverTime == null
        ? 0
        : activeXAxis === "distance"
          ? (() => {
              const idx = chartTimes.indexOf(hoverTime);
              const dist = idx >= 0 && chartTimeDistances ? (chartTimeDistances[idx] ?? null) : null;
              return dist != null ? x(dist) : x(hoverTime);
            })()
          : x(hoverTime);

    const svg = (
      <svg
        className={interactive ? "size-full touch-none overflow-visible focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" : `${heightClass} w-full overflow-visible`}
        viewBox={`0 0 ${LINE_CHART_VIEWBOX_WIDTH} 158`}
        role={interactive ? "slider" : "img"}
        aria-label={tx("vehicle.charts.chartAria", { title })}
        aria-orientation={interactive ? "horizontal" : undefined}
        aria-valuemin={interactive ? 0 : undefined}
        aria-valuemax={interactive ? Math.max(0, chartTimes.length - 1) : undefined}
        aria-valuenow={interactive && hoverTime != null ? Math.max(0, chartTimes.indexOf(hoverTime)) : undefined}
        aria-valuetext={interactive && hoverTime != null ? formatClock(hoverTime) : undefined}
        tabIndex={interactive ? 0 : undefined}
        onKeyDown={interactive ? handleKeyDown : undefined}
        onPointerDown={interactive ? (event) => {
          updateSelectedTime(event.currentTarget, event.clientX, event.clientY);
          event.currentTarget.setPointerCapture(event.pointerId);
        } : undefined}
        onPointerMove={interactive ? (event) => updateSelectedTime(event.currentTarget, event.clientX, event.clientY) : undefined}
        onPointerUp={interactive ? (event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        } : undefined}
        onPointerCancel={interactive ? (event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        } : undefined}
        onPointerLeave={interactive ? (event) => {
          if (event.pointerType !== "touch") setHoverTime(null);
        } : undefined}
      >
      <line x1="34" x2="318" y1="104" y2="104" stroke="currentColor" className="text-border" strokeWidth="1" />
      <line x1="34" x2="34" y1="16" y2="104" stroke="currentColor" className="text-border" strokeWidth="1" />
      {dualAxis ? <line x1="318" x2="318" y1="16" y2="104" stroke="currentColor" className="text-border" strokeWidth="1" /> : null}
      {dualAxis
        ? series.map((item, seriesIndex) =>
            seriesScales[seriesIndex].yTicks
              // The speed scale may contain a synthetic negative range to align zero
              // with regeneration. Negative speed is not a meaningful user-facing value.
              .filter((tick) => seriesIndex !== 0 || tick.value >= 0)
              .map((tick, index) => (
              <g key={`${title}-y-${seriesIndex}-${index}`}>
                {tick.value !== 0 || seriesIndex === 0 ? (
                  <line x1="34" x2="318" y1={y(seriesIndex, tick.value)} y2={y(seriesIndex, tick.value)} stroke="currentColor" className="text-border/40" strokeWidth="1" strokeDasharray="4 6" />
                ) : null}
                {seriesIndex === 0 ? (
                  <text x="29" y={y(seriesIndex, tick.value) + 3} textAnchor="end" className="fill-muted-foreground text-[9px]">
                    {tick.label}
                  </text>
                ) : null}
                {seriesIndex === series.length - 1 ? (
                  <text x={RIGHT_AXIS_TICK_X} y={y(seriesIndex, tick.value) + 3} textAnchor="start" className="fill-muted-foreground text-[9px]">
                    {tick.label}
                  </text>
                ) : null}
              </g>
            )),
          )
        : singleYTicks.map((tick, index) => (
            <g key={`${title}-y-${index}`}>
              <line x1="34" x2="318" y1={y(0, tick.value)} y2={y(0, tick.value)} stroke="currentColor" className="text-border/60" strokeWidth="1" strokeDasharray="4 6" />
              <text x="29" y={y(0, tick.value) + 3} textAnchor="end" className="fill-muted-foreground text-[9px]">
                {tick.label}
              </text>
            </g>
          ))}
      {xTicks.map((tick, index) => (
        <g key={`${title}-x-${index}`}>
          <line x1={x(tick.xVal)} x2={x(tick.xVal)} y1="104" y2="109" stroke="currentColor" className="text-border" strokeWidth="1" />
          <text x={x(tick.xVal)} y="124" textAnchor="middle" className="fill-muted-foreground text-[9px]">
            {tick.label}
          </text>
        </g>
      ))}
      <text x="176" y="148" textAnchor="middle" className="fill-muted-foreground text-[9px]">
        {xAxisLabel}
      </text>
      {dualAxis ? (
        <>
          <text x={LEFT_AXIS_UNIT_X} y="60" textAnchor="middle" transform={`rotate(-90 ${LEFT_AXIS_UNIT_X} 60)`} className="fill-muted-foreground text-[9px]">
            {seriesUnit(series[0], unit)}
          </text>
          <text x={RIGHT_AXIS_UNIT_X} y="60" textAnchor="middle" transform={`rotate(90 ${RIGHT_AXIS_UNIT_X} 60)`} className="fill-muted-foreground text-[9px]">
            {seriesUnit(series[series.length - 1], unit)}
          </text>
        </>
      ) : (
        <text x={LEFT_AXIS_UNIT_X} y="60" textAnchor="middle" transform={`rotate(-90 ${LEFT_AXIS_UNIT_X} 60)`} className="fill-muted-foreground text-[9px]">
          {unit}
        </text>
      )}
      {series.map((item, seriesIndex) => {
        const pathSegments = buildBrokenLinePaths(
          item.points,
          (point) => ({
            x: xCoord(point),
            y: y(seriesIndex, point.value),
          }),
          lineGapMs,
        );
        const markers = item.points.length <= MAX_CHART_MARKERS ? item.points : [];
        return (
          <g key={item.label}>
            {pathSegments.map((d, pathIndex) => (
              <path
                key={`${item.label}-path-${pathIndex}`}
                d={d}
                fill="none"
                stroke={item.color}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
            {item.points.map((point, index) => (
              <circle
                key={`${item.label}-hit-${point.time}-${index}`}
                cx={xCoord(point)}
                cy={y(seriesIndex, point.value)}
                r="7"
                fill="transparent"
              >
                {!interactive ? <title>{pointTitle(item, point)}</title> : null}
              </circle>
            ))}
            {markers.map((point, index) => (
              <circle key={`${item.label}-${point.time}-${index}`} cx={xCoord(point)} cy={y(seriesIndex, point.value)} r="3.5" fill={item.color}>
                {!interactive ? <title>{pointTitle(item, point)}</title> : null}
              </circle>
            ))}
            {interactive && hoverTime != null
              ? (() => {
                  const point = nearestPointByTime(item.points, hoverTime);
                  if (!point) return null;
                  return (
                    <circle
                      cx={xCoord(point)}
                      cy={y(seriesIndex, point.value)}
                      r="5"
                      fill="#ffffff"
                      stroke={item.color}
                      strokeWidth="2"
                      pointerEvents="none"
                    />
                  );
                })()
              : null}
          </g>
        );
      })}
      {interactive && hoverTime != null ? (
        <ChartHoverCrosshair snapX={hoverX} plotTop={STD_CHART.plotTop} plotBottom={STD_CHART.plotBottom} />
      ) : null}
      </svg>
    );

    return (
      <InteractiveChartShell
        heightClass={heightClass}
        interactive={interactive}
        tooltip={
          interactive && hoverTime != null && hoverRows.length > 0 ? (
            <ChartDataTooltip
              title={formatClock(hoverTime)}
              rows={hoverRows.map(({ label, value, color }) => ({ label, value, color }))}
              viewBoxX={hoverX}
              viewBoxY={Math.min(...hoverRows.map((row) => row.y)) - 8}
              viewBoxWidth={LINE_CHART_VIEWBOX_WIDTH}
              viewBoxHeight={STD_CHART.height}
            />
          ) : null
        }
      >
        {svg}
      </InteractiveChartShell>
    );
  };

  return (
    <article className="rounded-2xl border border-border bg-white/[0.02] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-heading text-lg font-semibold tracking-tight">{title}</h3>
        </div>
        <div className="flex shrink-0 items-center">
          <IconButton label={tx("vehicle.charts.fullscreen")} onClick={() => setIsOpen(true)}>
            <Maximize2 className="size-4" aria-hidden />
          </IconButton>
        </div>
      </div>

      <div className="mt-4">{plot("h-44")}</div>

      <Dialog
        open={isOpen}
        onOpenChange={(open) => {
          setIsOpen(open);
          if (!open) {
            setHoverTime(null);
            setTimeZoom(0);
          }
        }}
      >
        <DialogContent className="h-[calc(100dvh-1rem)] max-w-[calc(100vw-1rem)] content-start gap-3 overflow-y-auto p-3 sm:max-w-[calc(100vw-2rem)]">
          <DialogTitle className="sr-only">{title}</DialogTitle>
          <div className="flex items-start justify-between gap-3 px-1">
            <div>
              <h3 className="font-heading text-xl font-semibold tracking-tight">{title}</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {hasData ? rangeLabel : tx("vehicle.charts.noValues")}
              </p>
            </div>
            {activeXAxis === "time" ? (
              <div className="flex shrink-0 items-center gap-1" aria-label="Graph time scale">
                <IconButton label="Zoom out graph" onClick={() => setTimeZoom((value) => Math.max(0, value - 1))} disabled={timeZoom === 0}>
                  <Minus className="size-4" aria-hidden />
                </IconButton>
                <button
                  type="button"
                  onClick={() => setTimeZoom(0)}
                  className="h-9 min-w-12 rounded-full border border-border bg-white/[0.03] px-2 text-xs text-muted-foreground"
                  aria-label="Reset graph zoom"
                >
                  {2 ** timeZoom}×
                </button>
                <IconButton label="Zoom in graph" onClick={() => setTimeZoom((value) => Math.min(4, value + 1))} disabled={timeZoom === 4}>
                  <Plus className="size-4" aria-hidden />
                </IconButton>
              </div>
            ) : null}
          </div>
          {plot("aspect-[360/158] max-h-[38dvh] w-full", true)}
          <div className="px-1 pt-1">
            <ChartSeriesLegend series={series} />
          </div>
          {trackPoints?.length || mapPoints?.length ? (
            <RouteMap
              points={mapPoints}
              trackPoints={trackPoints}
              selectedTimeMs={hoverTime}
              embedded
              allowFullscreen={false}
              compact
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </article>
  );
}

function DeltaBySocChart({
  chart,
  lineGapMs = CHART_LINE_GAP_MS,
}: {
  chart: DeltaBySocChartModel;
  lineGapMs?: number;
}) {
  const { t } = useTranslation();
  const tx = t as Translator;
  const [isOpen, setIsOpen] = useState(false);
  const [zoom, setZoom] = useState(0);
  const { points, latest } = chart;

  if (points.length === 0) {
    return null;
  }

  const zoomOut = () => setZoom((value) => Math.max(0, value - 1));
  const zoomIn = () => setZoom((value) => Math.min(5, value + 1));
  const resetZoom = () => setZoom(0);
  const zoomFactor = 1 + zoom * 0.45;

  return (
    <article className="mt-3 rounded-2xl border border-border bg-white/[0.02] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-heading text-lg font-semibold tracking-tight">
            {tx("vehicle.charts.deltaBySoc")}
          </h3>
          <p className="mt-1 max-w-[22rem] text-xs leading-5 text-muted-foreground">
            {tx("vehicle.charts.deltaBySocSubtitle", { value: points.length })}
          </p>
        </div>
        <IconButton label={tx("vehicle.charts.fullscreen")} onClick={() => setIsOpen(true)}>
          <Maximize2 className="size-4" aria-hidden />
        </IconButton>
      </div>

      <div className="mt-4">
        <DeltaBySocPlot chart={chart} zoom={0} heightClassName="h-44" lineGapMs={lineGapMs} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <DeltaBySocStat compact label={tx("vehicle.charts.points")} value={points.length.toString()} />
        <DeltaBySocStat compact label={tx("vehicle.charts.socRange")} value={`${fmt(chart.minSoc, 0)}-${fmt(chart.maxSoc, 0)}%`} />
        <DeltaBySocStat compact label={tx("vehicle.charts.deltaRange")} value={`${fmt(chart.minDelta, 3)}-${fmt(chart.maxDelta, 3)} V`} />
        <DeltaBySocStat
          compact
          label={tx("vehicle.charts.latestPoint")}
          value={latest ? `${fmt(latest.soc, 0)}% / ${fmt(latest.delta, 3)} V` : "—"}
        />
      </div>

      <Dialog
        open={isOpen}
        onOpenChange={(open) => {
          setIsOpen(open);
        }}
      >
        <DialogContent className="h-[calc(100dvh-1rem)] max-w-[calc(100vw-1rem)] gap-3 p-3 sm:max-w-[calc(100vw-2rem)]">
          <DialogTitle className="sr-only">{tx("vehicle.charts.deltaBySoc")}</DialogTitle>
          <div className="flex flex-wrap items-start justify-between gap-3 px-1">
            <div>
              <h3 className="font-heading text-xl font-semibold tracking-tight">
                {tx("vehicle.charts.deltaBySoc")}
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {tx("vehicle.charts.deltaBySocSubtitle", { value: points.length })}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <IconButton
                label={tx("vehicle.charts.zoomOut")}
                onClick={zoomOut}
                disabled={zoom === 0}
              >
                <Minus className="size-4" aria-hidden />
              </IconButton>
              <button
                type="button"
                onClick={resetZoom}
                className="h-9 rounded-full border border-border bg-white/[0.03] px-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground transition hover:border-primary/50 hover:text-foreground disabled:opacity-45"
                disabled={zoom === 0}
                title={tx("vehicle.charts.resetZoom")}
              >
                {zoom === 0 ? "1x" : `${fmt(zoomFactor, 1)}x`}
              </button>
              <IconButton
                label={tx("vehicle.charts.zoomIn")}
                onClick={zoomIn}
                disabled={zoom === 5}
              >
                <Plus className="size-4" aria-hidden />
              </IconButton>
            </div>
          </div>
          <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[1fr_15rem]">
            <DeltaBySocPlot
              chart={chart}
              zoom={zoom}
              heightClassName="h-full min-h-[22rem]"
              interactive
              lineGapMs={lineGapMs}
            />
            <div className="grid content-start gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <DeltaBySocStat label={tx("vehicle.charts.points")} value={points.length.toString()} />
              <DeltaBySocStat label={tx("vehicle.charts.socRange")} value={`${fmt(chart.minSoc, 0)}-${fmt(chart.maxSoc, 0)}%`} />
              <DeltaBySocStat label={tx("vehicle.charts.deltaRange")} value={`${fmt(chart.minDelta, 3)}-${fmt(chart.maxDelta, 3)} V`} />
              <DeltaBySocStat
                label={tx("vehicle.charts.latestPoint")}
                value={latest ? `${fmt(latest.soc, 0)}% / ${fmt(latest.delta, 3)} V` : "—"}
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </article>
  );
}

function DeltaBySocPlot({
  chart,
  heightClassName,
  interactive = false,
  lineGapMs = CHART_LINE_GAP_MS,
}: {
  chart: DeltaBySocChartModel;
  zoom?: number;
  heightClassName: string;
  interactive?: boolean;
  lineGapMs?: number;
}) {
  const { t } = useTranslation();
  const tx = t as Translator;
  const clipId = useId();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const { points, latest } = chart;
  const visibleMinDelta = Math.min(...points.map((point) => point.delta));
  const visibleMaxDelta = Math.max(...points.map((point) => point.delta));
  const minSoc = Math.min(...points.map((point) => point.soc));
  const maxSoc = Math.max(...points.map((point) => point.soc));
  const minTime = Math.min(...points.map((point) => point.time));
  const maxTime = Math.max(...points.map((point) => point.time));
  const deltaPad = Math.max((visibleMaxDelta - visibleMinDelta) * 0.14, 0.005);
  const yMin = Math.max(0, visibleMinDelta - deltaPad);
  const yMax = visibleMaxDelta + deltaPad;
  const effectiveLineGapMs = deltaBySocTripLineGapMs(points, lineGapMs);

  const x = (time: number) => {
    if (maxTime === minTime || !Number.isFinite(time)) return 160;
    return 24 + ((time - minTime) / (maxTime - minTime)) * 272;
  };
  const y = (delta: number) => {
    if (yMax === yMin) return 72;
    return 110 - ((delta - yMin) / (yMax - yMin)) * 92;
  };
  const socY = (soc: number) => {
    if (maxSoc === minSoc) return 72;
    return 110 - ((soc - minSoc) / (maxSoc - minSoc)) * 92;
  };
  const linePaths = buildBrokenLinePaths(
    points,
    (point) => ({
      x: x(point.time),
      y: y(point.delta),
    }),
    effectiveLineGapMs,
  );
  const socPaths = buildBrokenLinePaths(
    points,
    (point) => ({
      x: x(point.time),
      y: socY(point.soc),
    }),
    effectiveLineGapMs,
  );
  const markerPoints =
    points.length <= MAX_CHART_MARKERS ? points : latest ? [latest] : [];
  const hoveredPoint = hoverIndex == null ? null : points[hoverIndex] ?? null;

  const handleMouseMove = (event: React.MouseEvent<SVGSVGElement>) => {
    const pointer = clientToSvg(
      event.currentTarget,
      event.clientX,
      event.clientY,
      DELTA_SOC_CHART.width,
      DELTA_SOC_CHART.height,
    );
    if (pointer.x < DELTA_SOC_CHART.plotLeft || pointer.x > DELTA_SOC_CHART.plotRight || points.length === 0) {
      setHoverIndex(null);
      return;
    }
    const xPositions = points.map((point) => x(point.time));
    setHoverIndex(nearestIndexByX(pointer.x, xPositions));
  };

  const svg = (
    <svg
      className={interactive ? "size-full overflow-hidden" : `${heightClassName} w-full overflow-hidden`}
      viewBox="0 0 320 142"
      role="img"
      aria-label={tx("vehicle.charts.deltaBySoc")}
      onMouseMove={interactive ? handleMouseMove : undefined}
      onMouseLeave={interactive ? () => setHoverIndex(null) : undefined}
    >
        <defs>
          <clipPath id={clipId}>
            <rect x="24" y="18" width="272" height="92" />
          </clipPath>
        </defs>
        <line x1="24" x2="296" y1="110" y2="110" stroke="currentColor" className="text-border" strokeWidth="1" />
        <line x1="24" x2="24" y1="18" y2="110" stroke="currentColor" className="text-border" strokeWidth="1" />
        <line x1="24" x2="296" y1="64" y2="64" stroke="currentColor" className="text-border/70" strokeWidth="1" strokeDasharray="4 6" />
        <text x="24" y="132" className="fill-muted-foreground text-[10px]">
          {formatClock(minTime)}
        </text>
        <text x="296" y="132" textAnchor="end" className="fill-muted-foreground text-[10px]">
          {formatClock(maxTime)}
        </text>
        <text x="30" y="14" className="fill-muted-foreground text-[10px]">
          {fmt(yMax, 3)} V
        </text>
        <text x="30" y="106" className="fill-muted-foreground text-[10px]">
          {fmt(yMin, 3)} V
        </text>
        <text x="296" y="14" textAnchor="end" className="fill-primary text-[10px]">
          {fmt(maxSoc, 0)}% SOC
        </text>
        <text x="296" y="106" textAnchor="end" className="fill-primary text-[10px]">
          {fmt(minSoc, 0)}% SOC
        </text>
        <g clipPath={`url(#${clipId})`}>
          {socPaths.map((d, pathIndex) => (
            <path
              key={`soc-path-${pathIndex}`}
              d={d}
              fill="none"
              stroke="#22c55e"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.78"
              strokeDasharray="3 5"
            />
          ))}
          {linePaths.map((d, pathIndex) => (
            <path
              key={`delta-path-${pathIndex}`}
              d={d}
              fill="none"
              stroke="#38bdf8"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.78"
            />
          ))}
          {markerPoints.map((point, index) => {
            const isLatest = point === latest;
            const highlighted = interactive && hoveredPoint?.time === point.time;
            return (
              <circle
                key={`${point.time}-${index}`}
                cx={x(point.time)}
                cy={y(point.delta)}
                r={highlighted ? 4.5 : isLatest ? 4 : 3}
                fill={highlighted ? "#ffffff" : isLatest ? "#facc15" : "#fb7185"}
                stroke={highlighted ? "#38bdf8" : "none"}
                strokeWidth={highlighted ? 2 : 0}
                opacity={isLatest || highlighted ? 1 : 0.78}
              />
            );
          })}
        </g>
        {interactive && hoveredPoint ? (
          <ChartHoverCrosshair
            snapX={x(hoveredPoint.time)}
            plotTop={DELTA_SOC_CHART.plotTop}
            plotBottom={DELTA_SOC_CHART.plotBottom}
          />
        ) : null}
      </svg>
  );

  return (
    <div className="rounded-2xl border border-border bg-background/30 p-3">
      <InteractiveChartShell
        heightClass={heightClassName}
        interactive={interactive}
        tooltip={
          interactive && hoveredPoint ? (
            <ChartDataTooltip
              title={formatClock(hoveredPoint.time)}
              rows={[
                { label: tx("vehicle.charts.soc"), value: `${fmt(hoveredPoint.soc, 0)}%`, color: "#22c55e" },
                { label: tx("vehicle.charts.cellDelta"), value: `${fmt(hoveredPoint.delta, 3)} V`, color: "#38bdf8" },
              ]}
              viewBoxX={x(hoveredPoint.time)}
              viewBoxY={y(hoveredPoint.delta)}
              viewBoxWidth={DELTA_SOC_CHART.width}
              viewBoxHeight={DELTA_SOC_CHART.height}
              placement="auto"
            />
          ) : null
        }
      >
        {svg}
      </InteractiveChartShell>
      <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-[#38bdf8]" />
          Delta
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded-full border-t-2 border-dashed border-[#22c55e]" />
          SOC
        </span>
      </div>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="grid size-9 place-items-center rounded-full border border-border bg-white/[0.03] text-muted-foreground transition hover:border-primary/50 hover:text-foreground disabled:opacity-45"
      title={label}
      aria-label={label}
    >
      {children}
    </button>
  );
}

function DeltaBySocStat({ label, value, compact = false }: { label: string; value: string; compact?: boolean }) {
  return (
    <div className={`rounded-2xl border border-border bg-background/30 ${compact ? "p-3" : "p-3"}`}>
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-2 font-mono text-sm text-foreground">{value}</p>
    </div>
  );
}
