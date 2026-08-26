"use client";

import type { TelemetryHistoryPoint } from "@/lib/voltflowmate/telemetry-history";
import type { AuxVoltageDailyPoint } from "@/lib/voltflowmate/aux-voltage-history";
import { normalizeAuxVoltage } from "@/lib/voltflowmate/aux-voltage-history";
import type { TelemetryHistoryRange } from "@/lib/voltflowmate/telemetry-ranges";
import { VEHICLE_CONTROL_LOW_AUX_V as LOW_AUX_V } from "@/lib/vehicle/vehicle-control-guards";

type ChartPoint = { time: number; min: number; max: number; resting: number | null };

export function AuxVoltageTrendChart({ range, dailyPoints, dayPoints, baseline, locale, baselineLabel, commandBlockLabel }: {
  range: TelemetryHistoryRange;
  dailyPoints: readonly AuxVoltageDailyPoint[];
  dayPoints: readonly TelemetryHistoryPoint[];
  baseline: number | null;
  locale: string;
  baselineLabel: string;
  commandBlockLabel: string;
}) {
  const points: ChartPoint[] = range === "day"
    ? dayPoints.flatMap((point) => {
        const voltage = normalizeAuxVoltage(point.telemetry.aux_voltage_v);
        return voltage == null ? [] : [{ time: Date.parse(point.device_time), min: voltage, max: voltage, resting: voltage }];
      })
    : dailyPoints.map((point) => ({ time: Date.parse(`${point.date}T12:00:00Z`), min: point.vMin, max: point.vMax, resting: point.vResting }));
  if (points.length === 0) return null;

  const minTime = points[0].time;
  const maxTime = points.at(-1)!.time;
  const values = points.flatMap((point) => [point.min, point.max, ...(point.resting == null ? [] : [point.resting])]);
  if (baseline != null) values.push(baseline);
  values.push(LOW_AUX_V);
  const yMin = Math.max(6, Math.min(...values) - 0.3);
  const yMax = Math.min(18, Math.max(...values) + 0.3);
  const x = (time: number) => maxTime === minTime ? 176 : 36 + ((time - minTime) / (maxTime - minTime)) * 280;
  const y = (value: number) => 104 - ((value - yMin) / Math.max(yMax - yMin, 0.1)) * 88;
  const line = (items: { time: number; value: number | null }[]) => {
    let drawing = false;
    return items.map((item) => {
      if (item.value == null) { drawing = false; return ""; }
      const command = drawing ? "L" : "M";
      drawing = true;
      return `${command} ${x(item.time).toFixed(1)} ${y(item.value).toFixed(1)}`;
    }).join(" ");
  };
  const area = range === "day" ? "" : [
    ...points.map((point, index) => `${index ? "L" : "M"} ${x(point.time).toFixed(1)} ${y(point.max).toFixed(1)}`),
    ...[...points].reverse().map((point) => `L ${x(point.time).toFixed(1)} ${y(point.min).toFixed(1)}`), "Z",
  ].join(" ");
  const date = (time: number) => new Date(time).toLocaleDateString(locale, range === "day" ? { hour: "2-digit", minute: "2-digit" } : { month: "short", day: "numeric" });
  const refs = [{ value: LOW_AUX_V, label: commandBlockLabel, color: "#ef4444" }, ...(baseline == null ? [] : [{ value: baseline, label: baselineLabel, color: "#a78bfa" }])];

  return <svg className="h-52 w-full overflow-visible" viewBox="0 0 340 145" role="img">
    {[yMin, (yMin + yMax) / 2, yMax].map((value) => <g key={value}>
      <line x1="36" x2="316" y1={y(value)} y2={y(value)} className="text-border/40" stroke="currentColor" strokeDasharray="4 6" />
      <text x="31" y={y(value) + 3} textAnchor="end" fontSize="9" className="fill-muted-foreground">{value.toFixed(1)}V</text>
    </g>)}
    {refs.map((ref) => <g key={ref.label}>
      <line x1="36" x2="316" y1={y(ref.value)} y2={y(ref.value)} stroke={ref.color} strokeWidth="1.2" strokeDasharray="5 4" />
      <text x="314" y={y(ref.value) - 3} textAnchor="end" fontSize="8" fill={ref.color}>{ref.label}</text>
    </g>)}
    {area ? <path d={area} fill="var(--voltflow-cyan)" opacity="0.16" /> : null}
    <path d={line(points.map((point) => ({ time: point.time, value: point.resting })))} fill="none" stroke="var(--voltflow-cyan)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    {[minTime, (minTime + maxTime) / 2, maxTime].map((time, index) => <text key={index} x={x(time)} y="125" textAnchor="middle" fontSize="9" className="fill-muted-foreground">{date(time)}</text>)}
  </svg>;
}
