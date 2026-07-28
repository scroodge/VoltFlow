"use client";

import { useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Maximize2, Minimize2 } from "lucide-react";

import { ChartSeriesLegend, TelemetryBarChart, type BarChartModel } from "@/components/vehicle/telemetry-analytics-charts";
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
import { formatHistoryRangeSubtitle } from "@/lib/bydmate/telemetry-buckets";
import type { TelemetryHistoryRange } from "@/lib/bydmate/telemetry-ranges";
import { MAX_TELEMETRY_CHART_POINTS, medianSampleGapSeconds } from "@/lib/bydmate/telemetry-ranges";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "@/hooks/use-translation";
import { calculateRegenRecoverySegments, prepareRegenRecoveryBars } from "@/lib/bydmate/trip-energy";
import type { Locale, TranslationKey } from "@/lib/i18n";
import type { BydmateDiplus, BydmateLocation, BydmateTelemetry } from "@/types/database";

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
  telemetry: BydmateTelemetry;
  diplus?: BydmateDiplus;
  diplus_min_cell_voltage_v?: number | null;
  diplus_max_cell_voltage_v?: number | null;
  diplus_cell_delta_v?: number | null;
  regen_kwh_sum?: number | null;
  traction_kwh_sum?: number | null;
  location?: BydmateLocation;
  hourly?: {
    soc_min: number | null;
    soc_max: number | null;
  };
};

const MAX_CHART_POINTS = 240;
const MAX_TRIP_CHART_POINTS = MAX_TELEMETRY_CHART_POINTS;
const MAX_CHART_MARKERS = 80;
const MAX_DELTA_BY_SOC_POINTS = 240;
const REGEN_POWER_THRESHOLD_KW = 0.05;
const COAST_POWER_COLOR = "#475569";

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
