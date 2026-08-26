"use client";

import { useMemo, useState } from "react";

import {
  STD_CHART,
  ChartDataTooltip,
  ChartHoverCrosshair,
  InteractiveChartShell,
  buildBrokenLinePaths,
  chartLineGapMs,
  clientToSvg,
  nearestIndexByX,
  nearestPointByTime,
  splitByTimeGap,
} from "@/components/vehicle/chart-interaction";
import { isTelemetryHistoryCharging } from "@/features/charging/domain";
import type { TranslationKey } from "@/lib/i18n";
import { AUX_BATTERY_REFERENCES, type AuxBatteryChemistry } from "@/lib/vehicle/aux-battery-chemistry";
import type { AuxVoltageDailyPoint } from "@/lib/voltflowmate/aux-voltage-history";
import { normalizeAuxVoltage } from "@/lib/voltflowmate/aux-voltage-history";
import type { TelemetryHistoryPoint } from "@/lib/voltflowmate/telemetry-history";
import type { TelemetryHistoryRange } from "@/lib/voltflowmate/telemetry-ranges";

type Translator = (key: TranslationKey, values?: Record<string, string | number>) => string;
type VehicleState = "driving" | "charging" | "parked";
type ChartPoint = {
  time: number;
  min: number;
  max: number;
  resting: number | null;
  state: VehicleState | "resting" | "noResting";
};
type DayPoint = ChartPoint & { source: TelemetryHistoryPoint };

const STATE_COLORS: Record<VehicleState, string> = {
  driving: "#60a5fa",
  charging: "#a78bfa",
  parked: "#64748b",
};
const DAILY_GAP_MS = 36 * 60 * 60 * 1000;
const LOW_MARKER_NEAR_V = 0.5;

function stateForPoint(point: TelemetryHistoryPoint): VehicleState {
  if (isTelemetryHistoryCharging(point.telemetry, point)) return "charging";
  const speed = Number(point.telemetry.speed_kmh ?? 0);
  const power = Number(point.telemetry.power_kw ?? 0);
  return speed > 0.5 || Math.abs(power) > 0.1 ? "driving" : "parked";
}

function medianGapSeconds(points: readonly { time: number }[]) {
  const gaps = points.slice(1).map((point, index) => (point.time - points[index]!.time) / 1000).filter((gap) => gap > 0);
  if (gaps.length === 0) return null;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)]!;
}

function restingSpans(points: DayPoint[]) {
  const spans: Array<{ start: number; end: number }> = [];
  let parkedStart: number | null = null;
  let qualifyingStart: number | null = null;
  let previousTime: number | null = null;

  for (const point of points) {
    if (point.state !== "parked") {
      if (qualifyingStart != null && previousTime != null) spans.push({ start: qualifyingStart, end: previousTime });
      parkedStart = null;
      qualifyingStart = null;
      previousTime = point.time;
      continue;
    }
    parkedStart ??= point.time;
    if (qualifyingStart == null && point.time >= parkedStart + 2 * 60 * 60 * 1000) qualifyingStart = point.time;
    previousTime = point.time;
  }
  if (qualifyingStart != null && previousTime != null) spans.push({ start: qualifyingStart, end: previousTime });
  return spans;
}

export function AuxVoltageTrendChart({ range, dailyPoints, dayPoints, baseline, chemistry, locale, tx }: {
  range: TelemetryHistoryRange;
  dailyPoints: readonly AuxVoltageDailyPoint[];
  dayPoints: readonly TelemetryHistoryPoint[];
  baseline: number | null;
  chemistry: AuxBatteryChemistry;
  locale: string;
  tx: Translator;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const isDay = range === "day";
  const dayChartPoints = useMemo<DayPoint[]>(() => dayPoints.flatMap((point) => {
    const voltage = normalizeAuxVoltage(point.telemetry.aux_voltage_v);
    return voltage == null ? [] : [{
      time: Date.parse(point.device_time), min: voltage, max: voltage, resting: voltage,
      state: stateForPoint(point), source: point,
    }];
  }).sort((a, b) => a.time - b.time), [dayPoints]);
  const points = useMemo<ChartPoint[]>(() => isDay ? dayChartPoints : dailyPoints.map((point) => ({
    time: Date.parse(`${point.date}T12:00:00Z`), min: point.vMin, max: point.vMax,
    resting: point.vResting, state: point.vResting == null ? "noResting" : "resting",
  })), [dailyPoints, dayChartPoints, isDay]);
  if (points.length === 0) return null;

  const minTime = points[0]!.time;
  const maxTime = points.at(-1)!.time;
  const dataValues = points.flatMap((point) => [point.min, point.max, ...(point.resting == null ? [] : [point.resting])]);
  if (baseline != null) dataValues.push(baseline);
  const dataMin = Math.min(...dataValues);
  const dataMax = Math.max(...dataValues);
  const pad = Math.max((dataMax - dataMin) * 0.15, 0.12);
  const yMin = Math.max(6, dataMin - pad);
  const yMax = Math.min(18, dataMax + pad);
  const x = (time: number) => maxTime === minTime ? (STD_CHART.plotLeft + STD_CHART.plotRight) / 2 : STD_CHART.plotLeft + ((time - minTime) / (maxTime - minTime)) * (STD_CHART.plotRight - STD_CHART.plotLeft);
  const y = (value: number) => STD_CHART.plotBottom - ((value - yMin) / Math.max(yMax - yMin, 0.1)) * (STD_CHART.plotBottom - STD_CHART.plotTop);
  const dayGapMs = chartLineGapMs(medianGapSeconds(dayChartPoints), minTime, maxTime, points.length);
  const lineGapMs = isDay ? dayGapMs : DAILY_GAP_MS;
  const lineRuns = isDay ? [points] : points.reduce<ChartPoint[][]>((runs, point) => {
    if (point.resting == null) { runs.push([]); return runs; }
    if (runs.length === 0 || runs.at(-1)!.length === 0) runs.push([point]); else runs.at(-1)!.push(point);
    return runs;
  }, []);
  const linePaths = lineRuns.flatMap((run) => buildBrokenLinePaths(run, (point) => ({ x: x(point.time), y: y(point.resting!) }), lineGapMs));
  const stateSegments = isDay ? splitByTimeGap(dayChartPoints, dayGapMs) : [];
  const restSpans = isDay ? stateSegments.flatMap((segment) => restingSpans(segment)) : [];
  const area = isDay ? "" : [
    ...points.map((point, index) => `${index ? "L" : "M"} ${x(point.time).toFixed(1)} ${y(point.max).toFixed(1)}`),
    ...[...points].reverse().map((point) => `L ${x(point.time).toFixed(1)} ${y(point.min).toFixed(1)}`), "Z",
  ].join(" ");
  const xPositions = points.map((point) => x(point.time));
  const hovered = hoverIndex == null ? null : points[hoverIndex] ?? null;
  const stateLabel = (state: ChartPoint["state"]) => tx(`vehicle.analytics.aux12vState.${state}` as TranslationKey);
  const dateLabel = (time: number) => new Date(time).toLocaleString(locale, isDay
    ? { hour: "2-digit", minute: "2-digit" }
    : { year: "numeric", month: "short", day: "numeric" });
  const shortDate = (time: number) => new Date(time).toLocaleDateString(locale, isDay
    ? { hour: "2-digit", minute: "2-digit" }
    : { month: "short", day: "numeric" });
  const reference = AUX_BATTERY_REFERENCES[chemistry];
  const lowVoltage = reference.lowVoltage;
  const lowWithinRange = lowVoltage >= yMin && lowVoltage <= yMax;
  const lowNearRange = !lowWithinRange && lowVoltage >= yMin - LOW_MARKER_NEAR_V;

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const pointer = clientToSvg(event.currentTarget, event.clientX, event.clientY, STD_CHART.width, STD_CHART.height);
    if (pointer.x < STD_CHART.plotLeft || pointer.x > STD_CHART.plotRight) return setHoverIndex(null);
    const nearestByX = nearestIndexByX(pointer.x, xPositions);
    const pointerTime = minTime + ((pointer.x - STD_CHART.plotLeft) / (STD_CHART.plotRight - STD_CHART.plotLeft)) * (maxTime - minTime);
    const nearest = nearestPointByTime(points, pointerTime);
    setHoverIndex(nearest ? points.indexOf(nearest) : nearestByX);
  };

  const svg = <svg
    className="size-full cursor-crosshair overflow-visible touch-pan-y"
    viewBox={`0 0 ${STD_CHART.width} ${STD_CHART.height}`}
    role="img"
    aria-label={tx("vehicle.analytics.aux12vTitle")}
    onPointerMove={handlePointerMove}
    onPointerDown={handlePointerMove}
    onPointerLeave={() => setHoverIndex(null)}
  >
    {restSpans.map((span, index) => <rect key={`rest-${index}`} x={x(span.start)} y={STD_CHART.plotTop} width={Math.max(1, x(span.end) - x(span.start))} height={STD_CHART.plotBottom - STD_CHART.plotTop} fill="var(--voltflow-cyan)" opacity="0.08" />)}
    {reference.restingBand ? <rect x={STD_CHART.plotLeft} y={y(Math.min(reference.restingBand[1], yMax))} width={STD_CHART.plotRight - STD_CHART.plotLeft} height={Math.max(0, y(Math.max(reference.restingBand[0], yMin)) - y(Math.min(reference.restingBand[1], yMax)))} fill="var(--voltflow-cyan)" opacity="0.06" /> : null}
    {[yMin, (yMin + yMax) / 2, yMax].map((value) => <g key={value}>
      <line x1={STD_CHART.plotLeft} x2={STD_CHART.plotRight} y1={y(value)} y2={y(value)} className="text-border/40" stroke="currentColor" strokeDasharray="4 6" />
      <text x={STD_CHART.plotLeft - 5} y={y(value) + 3} textAnchor="end" className="fill-muted-foreground text-[8px]">{value.toFixed(1)}V</text>
    </g>)}
    {baseline != null && baseline >= yMin && baseline <= yMax ? <g>
      <line x1={STD_CHART.plotLeft} x2={STD_CHART.plotRight} y1={y(baseline)} y2={y(baseline)} stroke="#a78bfa" strokeDasharray="5 4" />
      <text x={STD_CHART.plotRight - 2} y={y(baseline) - 3} textAnchor="end" fontSize="8" fill="#a78bfa">{tx("vehicle.analytics.aux12vBaseline")}</text>
    </g> : null}
    {lowWithinRange ? <g>
      <line x1={STD_CHART.plotLeft} x2={STD_CHART.plotRight} y1={y(lowVoltage)} y2={y(lowVoltage)} stroke="#ef4444" strokeDasharray="5 4" />
      <text x={STD_CHART.plotRight - 2} y={y(lowVoltage) - 3} textAnchor="end" fontSize="8" fill="#ef4444">{tx("vehicle.analytics.aux12vLowVoltageMarker")}</text>
    </g> : lowNearRange ? <text x={STD_CHART.plotRight} y={STD_CHART.plotBottom - 2} textAnchor="end" fontSize="8" fill="#ef4444">↓ {tx("vehicle.analytics.aux12vLowVoltageMarker")}</text> : null}
    {area ? <path d={area} fill="var(--voltflow-cyan)" opacity="0.16" /> : null}
    {linePaths.map((path, index) => <path key={index} d={path} fill="none" stroke="var(--voltflow-cyan)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />)}
    {points.filter((point) => point.resting != null).map((point, index) => <circle key={`point-${index}`} cx={x(point.time)} cy={y(point.resting!)} r={points.length <= 60 ? 2 : 1.25} fill="var(--voltflow-cyan)" />)}
    {isDay ? stateSegments.flatMap((segment, segmentIndex) => segment.slice(0, -1).map((point, index) => {
      const next = segment[index + 1]!;
      return <rect key={`state-${segmentIndex}-${index}`} x={x(point.time)} y="108" width={Math.max(1, x(next.time) - x(point.time))} height="6" fill={STATE_COLORS[point.state as VehicleState]} rx="1" />;
    })) : null}
    {[minTime, (minTime + maxTime) / 2, maxTime].map((time, index) => <text key={index} x={x(time)} y="130" textAnchor="middle" className="fill-muted-foreground text-[8px]">{shortDate(time)}</text>)}
    {hovered ? <ChartHoverCrosshair snapX={x(hovered.time)} plotTop={STD_CHART.plotTop} plotBottom={isDay ? 114 : STD_CHART.plotBottom} /> : null}
  </svg>;

  const tooltipRows = hovered ? isDay ? [
    { label: tx("vehicle.analytics.aux12vVoltage"), value: `${hovered.resting!.toFixed(2)} V`, color: "var(--voltflow-cyan)" },
    { label: tx("vehicle.analytics.aux12vStateLabel"), value: stateLabel(hovered.state) },
  ] : [
    { label: tx("vehicle.analytics.aux12vMin"), value: `${hovered.min.toFixed(2)} V` },
    { label: tx("vehicle.analytics.aux12vResting"), value: hovered.resting == null ? "—" : `${hovered.resting.toFixed(2)} V`, color: "var(--voltflow-cyan)" },
    { label: tx("vehicle.analytics.aux12vMax"), value: `${hovered.max.toFixed(2)} V` },
    { label: tx("vehicle.analytics.aux12vStateLabel"), value: stateLabel(hovered.state) },
  ] : [];

  return <InteractiveChartShell heightClass="h-52" interactive tooltip={hovered ? <ChartDataTooltip
    title={dateLabel(hovered.time)} rows={tooltipRows} viewBoxX={x(hovered.time)} viewBoxY={STD_CHART.plotTop + 8}
    viewBoxWidth={STD_CHART.width} viewBoxHeight={STD_CHART.height} placement="auto"
  /> : null}>{svg}</InteractiveChartShell>;
}
