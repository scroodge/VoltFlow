"use client";

import type { PointerEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { Maximize2, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

import {
  ChartDataTooltip,
  ChartHoverCrosshair,
  InteractiveChartShell,
  STD_CHART,
  buildBrokenLinePaths,
  chartLineGapMs,
  clientToSvg,
  nearestIndexByX,
} from "@/components/vehicle/chart-interaction";
import { Skeleton } from "@/components/ui/skeleton";
import { chargingPowerTemperaturePoints, type ChargingPowerTemperaturePoint } from "@/features/charging/_domain/charging-power-temperature-chart";
import { useVoltflowMateChargingSessionSamplesQuery } from "@/hooks/use-voltflowmate-charging-session-samples-query";
import { type TranslationKey } from "@/lib/i18n";
import type { ChargingSessionRow } from "@/types/database";
import { useTranslation } from "@/hooks/use-translation";

type Translator = (key: TranslationKey, values?: Record<string, string | number>) => string;

const POWER_COLOR = "#38bdf8";
const TEMPERATURE_COLOR = "#fb923c";

function axisRange(values: number[], floorAtZero = false) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = Math.max((max - min) * 0.14, floorAtZero ? 0.5 : 1);
  return {
    min: floorAtZero ? Math.max(0, min - pad) : min - pad,
    max: max + pad,
  };
}

function formatValue(value: number | null, digits = 1) {
  return value == null ? "—" : value.toFixed(digits);
}

function formatTime(time: number, locale: string, includeDate = false) {
  return new Date(time).toLocaleString(locale, includeDate
    ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
    : { hour: "2-digit", minute: "2-digit" });
}

export function ChargingPowerTemperatureChart({
  session,
  vehicleId,
}: {
  session: ChargingSessionRow;
  vehicleId?: string | null;
}) {
  const { locale, t } = useTranslation();
  const tx = t as Translator;
  const { data = [], isLoading, error } = useVoltflowMateChargingSessionSamplesQuery(
    session.id,
    vehicleId?.trim() || null,
    session.status,
  );
  const points = useMemo(() => chargingPowerTemperaturePoints(data), [data]);
  const hasPower = points.some((point) => point.powerKw != null);

  if (isLoading) return <Skeleton className="h-64 rounded-3xl" />;

  if (error || !hasPower) {
    return (
      <article className="rounded-3xl border border-border bg-card p-5">
        <h2 className="font-heading text-lg font-semibold tracking-tight">
          {tx("charging.powerTemperatureTimeline")}
        </h2>
        <p className="mt-3 rounded-2xl border border-border bg-background/30 p-4 text-sm leading-6 text-muted-foreground">
          {tx("charging.powerTemperatureTimelineEmpty")}
        </p>
      </article>
    );
  }

  return <PowerTemperaturePlot points={points} locale={locale} tx={tx} />;
}

/** Selected-session overlays for the weekly analytics comparison. */
export function ChargingSessionsComparison({
  sessions,
  vehicleId,
}: {
  sessions: ChargingSessionRow[];
  vehicleId: string;
}) {
  const { locale, t } = useTranslation();
  const tx = t as Translator;
  const [selected, setSelected] = useState<string[]>([]);
  const [series, setSeries] = useState<Record<string, ChargingPowerTemperaturePoint[]>>({});
  const sessionsWithTelemetry = sessions.filter((session) => session.started_at);

  return (
    <section className="mt-5 rounded-2xl border border-border bg-background/30 p-4">
      <h3 className="font-heading text-lg font-semibold">{tx("charging.powerTemperatureTimeline")}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{tx("vehicle.analytics.chargingCompareHint")}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {sessionsWithTelemetry.map((session, index) => {
          const active = selected.includes(session.id);
          return (
            <button key={session.id} type="button" aria-pressed={active}
              onClick={() => setSelected((ids) => active ? ids.filter((id) => id !== session.id) : [...ids, session.id])}
              className={`rounded-full border px-3 py-1.5 text-sm ${active ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground"}`}>
              {new Date(session.started_at!).toLocaleDateString(locale, { month: "short", day: "numeric" })} · {session.start_percent}→{session.current_percent}%
            </button>
          );
        })}
      </div>
      {selected.length > 0 ? (
        <div className="mt-4">
          {selected.map((id) => {
            const session = sessionsWithTelemetry.find((row) => row.id === id);
            return session ? <SelectedSessionPlot key={id} session={session} vehicleId={vehicleId} onPoints={(points) => setSeries((current) => ({ ...current, [id]: points }))} /> : null;
          })}
          <CombinedSessionsPlot sessions={sessionsWithTelemetry.filter((session) => selected.includes(session.id) && series[session.id]?.length)} series={series} locale={locale} tx={tx} />
        </div>
      ) : null}
    </section>
  );
}

function SelectedSessionPlot({ session, vehicleId, onPoints }: {
  session: ChargingSessionRow; vehicleId: string; onPoints: (points: ChargingPowerTemperaturePoint[]) => void;
}) {
  const { data = [], isLoading, error } = useVoltflowMateChargingSessionSamplesQuery(session.id, vehicleId, session.status);
  const points = useMemo(() => chargingPowerTemperaturePoints(data), [data]);
  useEffect(() => { if (!isLoading && !error) onPoints(points); }, [error, isLoading, onPoints, points]);
  return null;
}

function CombinedSessionsPlot({ sessions, series, locale, tx }: { sessions: ChargingSessionRow[]; series: Record<string, ChargingPowerTemperaturePoint[]>; locale: string; tx: Translator }) {
  const [zoom, setZoom] = useState(1);
  const [hover, setHover] = useState<number | null>(null);
  const colors = ["#38bdf8", "#fb923c", "#a78bfa", "#34d399", "#f472b6", "#facc15"];
  const prepared = sessions.map((session, i) => ({ session, points: series[session.id] ?? [], color: colors[i % colors.length]! }));
  const elapsed = prepared.flatMap(({ session, points }) => points.map((p) => p.time - Date.parse(session.started_at ?? "")));
  const fullElapsed = Math.max(1, ...elapsed);
  const maxElapsed = fullElapsed / zoom;
  const x = (ms: number) => 28 + (ms - (fullElapsed - maxElapsed)) / maxElapsed * 284;
  const allPower = prepared.flatMap(({ points }) => points.flatMap((p) => p.powerKw == null ? [] : [p.powerKw]));
  const allTemp = prepared.flatMap(({ points }) => points.flatMap((p) => p.batteryTempC == null ? [] : [p.batteryTempC]));
  const makePath = (points: ChargingPowerTemperaturePoint[], origin: number, key: "powerKw" | "batteryTempC", values: number[]) => {
    if (!values.length) return "";
    const min = Math.min(...values), max = Math.max(...values), span = Math.max(max - min, 0.5);
    return points.filter((p) => p[key] != null && p.time - origin >= fullElapsed - maxElapsed).map((p, i) => `${i ? "L" : "M"} ${x(p.time - origin).toFixed(1)} ${(105 - (p[key]! - min) / span * 82).toFixed(1)}`).join(" ");
  };
  if (!prepared.length) return <p className="text-sm text-muted-foreground">{tx("charging.powerTemperatureTimelineEmpty")}</p>;
  const powerRange = allPower.length ? axisRange(allPower, true) : null;
  const tempRange = allTemp.length ? axisRange(allTemp) : null;
  const hoveredRows = hover == null ? [] : prepared.flatMap(({ session, points, color }) => {
    const origin = Date.parse(session.started_at ?? "");
    const point = points.reduce<ChargingPowerTemperaturePoint | null>((best, p) => Math.abs(p.time - origin - hover) < Math.abs((best?.time ?? Infinity) - origin - hover) ? p : best, null);
    return point ? [{ session, point, color }] : [];
  });
  return <div className="mt-3"><div className="mb-2 flex flex-wrap items-center gap-3 text-xs">{prepared.map(({ session, color }) => <span key={session.id} style={{ color }}>{new Date(session.started_at!).toLocaleDateString(locale, { month: "short", day: "numeric" })}</span>)}<div className="ml-auto flex items-center gap-2"><Button size="sm" variant="outline" disabled={zoom <= 1} onClick={() => setZoom((z) => Math.max(1, z / 2))}>−</Button><span>{zoom}×</span><Button size="sm" variant="outline" disabled={zoom >= 8} onClick={() => setZoom((z) => Math.min(8, z * 2))}>+</Button></div></div><div className="relative"><svg viewBox="0 0 320 145" className="h-72 w-full touch-none" role="img" aria-label={tx("charging.powerTemperatureTimeline")} onPointerMove={(event) => { const rect = event.currentTarget.getBoundingClientRect(); const xPos = (event.clientX - rect.left) / rect.width * 320; setHover((fullElapsed - maxElapsed) + Math.max(0, Math.min(1, (xPos - 28) / 284)) * maxElapsed); }} onPointerLeave={() => setHover(null)}><line x1="28" y1="15" x2="28" y2="105" className="stroke-border"/><line x1="312" y1="15" x2="312" y2="105" className="stroke-border"/><text x="28" y="12" className="fill-sky-400 text-[8px]">{powerRange?.max.toFixed(1)} kW</text><text x="28" y="104" className="fill-sky-400 text-[8px]">{powerRange?.min.toFixed(1)} kW</text><text x="312" y="12" textAnchor="end" className="fill-orange-400 text-[8px]">{tempRange?.max.toFixed(1)} °C</text><text x="312" y="104" textAnchor="end" className="fill-orange-400 text-[8px]">{tempRange?.min.toFixed(1)} °C</text>{prepared.map(({ session, points, color }, i) => { const origin = Date.parse(session.started_at ?? ""); return <g key={session.id}><path d={makePath(points, origin, "powerKw", allPower)} fill="none" stroke={color} strokeWidth="2.5"/><path d={makePath(points, origin, "batteryTempC", allTemp)} fill="none" stroke={color} strokeWidth="2" strokeDasharray="5 4"/>{points.filter((p) => p.acOn != null && p.time - origin >= fullElapsed - maxElapsed).map((p) => <rect key={`ac-${p.time}`} x={x(p.time - origin)} y={112 + i * 5} width="3" height="3" fill={p.acOn ? "#ef4444" : "#475569"}><title>{p.acOn ? "A/C on" : "A/C off"}</title></rect>)}</g>; })}{hover != null ? <line x1={x(hover)} x2={x(hover)} y1="15" y2="138" stroke="white" strokeDasharray="3 3"/> : null}<text x="28" y="118" className="fill-muted-foreground text-[9px]">{Math.round((fullElapsed - maxElapsed) / 60000)} min</text><text x="312" y="118" textAnchor="end" className="fill-muted-foreground text-[9px]">{Math.round(fullElapsed / 60000)} min</text><text x="28" y="143" fill="#ef4444" fontSize="8">A/C</text></svg></div><div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground"><span>━ {tx("vehicle.telemetry.chargePower")} (kW)</span><span>┄ {tx("vehicle.telemetry.batteryTemp")} (°C)</span><span className="text-red-500">■ A/C on</span><span>■ A/C off</span></div>{hoveredRows.length ? <div className="mt-2 grid gap-1 text-xs">{hoveredRows.map(({ session, point, color }) => <p key={session.id} style={{ color }}>{new Date(session.started_at!).toLocaleDateString(locale, { month: "short", day: "numeric" })}: {((point.time - Date.parse(session.started_at!)) / 60000).toFixed(1)} min · {point.powerKw?.toFixed(1) ?? "—"} kW · {point.batteryTempC?.toFixed(1) ?? "—"} °C · A/C {point.acOn == null ? "—" : point.acOn ? "on" : "off"}</p>)}</div> : null}</div>;
}

function PowerTemperaturePlot({
  points,
  locale,
  tx,
  fullscreen = false,
}: {
  points: ChargingPowerTemperaturePoint[];
  locale: string;
  tx: Translator;
  fullscreen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [zoom, setZoom] = useState(0);
  const [windowPosition, setWindowPosition] = useState(1);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const fullMinTime = points[0]!.time;
  const fullMaxTime = points.at(-1)!.time;
  const windowDuration = (fullMaxTime - fullMinTime) / 2 ** zoom;
  const minTime = fullMinTime + (fullMaxTime - fullMinTime - windowDuration) * windowPosition;
  const maxTime = minTime + windowDuration;
  const visiblePoints = points.filter((point) => point.time >= minTime && point.time <= maxTime);
  const powerPoints = visiblePoints.filter((point) => point.powerKw != null);
  const temperaturePoints = visiblePoints.filter((point) => point.batteryTempC != null);
  const powerRange = axisRange(points.flatMap((point) => point.powerKw == null ? [] : [point.powerKw]), true);
  const temperatureRange = temperaturePoints.length > 0
    ? axisRange(temperaturePoints.map((point) => point.batteryTempC!))
    : null;
  const lineGapMs = chartLineGapMs(
    null,
    fullMinTime,
    fullMaxTime,
    points.length,
  );
  const x = (time: number) => maxTime === minTime
    ? (STD_CHART.plotLeft + STD_CHART.plotRight) / 2
    : STD_CHART.plotLeft + ((time - minTime) / (maxTime - minTime)) * (STD_CHART.plotRight - STD_CHART.plotLeft);
  const yFor = (value: number, range: { min: number; max: number }) => STD_CHART.plotBottom
    - ((value - range.min) / Math.max(range.max - range.min, 0.01)) * (STD_CHART.plotBottom - STD_CHART.plotTop);
  const powerPaths = buildBrokenLinePaths(
    powerPoints,
    (point) => ({ x: x(point.time), y: yFor(point.powerKw!, powerRange) }),
    lineGapMs,
  );
  const temperaturePaths = temperatureRange == null ? [] : buildBrokenLinePaths(
    temperaturePoints,
    (point) => ({ x: x(point.time), y: yFor(point.batteryTempC!, temperatureRange) }),
    lineGapMs,
  );
  const powerMarkers = powerPoints.length <= 160 ? powerPoints : powerPoints.slice(-1);
  const temperatureMarkers = temperaturePoints.length <= 160 ? temperaturePoints : temperaturePoints.slice(-1);
  const hovered = hoverIndex == null ? null : visiblePoints[hoverIndex] ?? null;

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const svgPoint = clientToSvg(event.currentTarget, event.clientX, event.clientY, STD_CHART.width, STD_CHART.height);
    setHoverIndex(nearestIndexByX(svgPoint.x, visiblePoints.map((point) => x(point.time))));
  };

  return (
    <article className="rounded-3xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-lg font-semibold tracking-tight">
            {tx("charging.powerTemperatureTimeline")}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {tx("vehicle.telemetry.chargePower")} · {tx("vehicle.telemetry.batteryTemp")}
          </p>
        </div>
        {!fullscreen ? (
          <Button variant="outline" size="icon-sm" aria-label={tx("vehicle.charts.fullscreen")} onClick={() => setIsOpen(true)}>
            <Maximize2 className="size-4" aria-hidden />
          </Button>
        ) : null}
      </div>

      <div className="my-3 flex items-center gap-2">
        <Button variant="outline" size="icon-sm" aria-label={tx("vehicle.charts.zoomOut")} disabled={zoom === 0} onClick={() => { setZoom((value) => Math.max(0, value - 1)); setHoverIndex(null); }}><Minus className="size-4" aria-hidden /></Button>
        <Button variant="ghost" size="sm" aria-label={tx("vehicle.charts.resetZoom")} onClick={() => { setZoom(0); setHoverIndex(null); }}>{2 ** zoom}×</Button>
        <Button variant="outline" size="icon-sm" aria-label={tx("vehicle.charts.zoomIn")} disabled={zoom === 4} onClick={() => { setZoom((value) => Math.min(4, value + 1)); setHoverIndex(null); }}><Plus className="size-4" aria-hidden /></Button>
      </div>
      {zoom > 0 ? (
        <input
          type="range"
          min="0"
          max="1"
          step="0.001"
          value={windowPosition}
          aria-label={tx("charging.powerTemperatureTimeline")}
          className="mb-3 w-full"
          onChange={(event) => { setWindowPosition(Number(event.target.value)); setHoverIndex(null); }}
        />
      ) : null}
      <InteractiveChartShell
        heightClass={fullscreen ? "h-[60dvh]" : "h-52"}
        interactive
        tooltip={hovered ? (
          <ChartDataTooltip
            title={formatTime(hovered.time, locale, true)}
            rows={[
              { label: tx("vehicle.telemetry.chargePower"), value: `${formatValue(hovered.powerKw)} kW`, color: POWER_COLOR },
              { label: tx("vehicle.telemetry.batteryTemp"), value: `${formatValue(hovered.batteryTempC)} °C`, color: TEMPERATURE_COLOR },
            ]}
            viewBoxX={x(hovered.time)}
            viewBoxY={STD_CHART.plotTop + 8}
            viewBoxWidth={STD_CHART.width}
            viewBoxHeight={STD_CHART.height}
            placement="auto"
          />
        ) : null}
      >
        <svg
          className="h-full w-full touch-none"
          viewBox={`0 0 ${STD_CHART.width} ${STD_CHART.height}`}
          role="img"
          aria-label={tx("charging.powerTemperatureTimeline")}
          onPointerMove={onPointerMove}
          onPointerLeave={() => setHoverIndex(null)}
        >
          <line x1={STD_CHART.plotLeft} x2={STD_CHART.plotRight} y1={STD_CHART.plotBottom} y2={STD_CHART.plotBottom} className="stroke-border" />
          <line x1={STD_CHART.plotLeft} x2={STD_CHART.plotLeft} y1={STD_CHART.plotTop} y2={STD_CHART.plotBottom} className="stroke-border" />
          <line x1={STD_CHART.plotRight} x2={STD_CHART.plotRight} y1={STD_CHART.plotTop} y2={STD_CHART.plotBottom} className="stroke-border" />
          <line x1={STD_CHART.plotLeft} x2={STD_CHART.plotRight} y1={(STD_CHART.plotTop + STD_CHART.plotBottom) / 2} y2={(STD_CHART.plotTop + STD_CHART.plotBottom) / 2} className="stroke-border/70" strokeDasharray="4 6" />
          <text x={STD_CHART.plotLeft} y="130" className="fill-muted-foreground text-[9px]">{formatTime(minTime, locale)}</text>
          <text x={STD_CHART.plotRight} y="130" textAnchor="end" className="fill-muted-foreground text-[9px]">{formatTime(maxTime, locale)}</text>
          <text x={STD_CHART.plotLeft} y="12" className="fill-[#38bdf8] text-[9px]">{formatValue(powerRange.max)} kW</text>
          <text x={STD_CHART.plotLeft} y={STD_CHART.plotBottom - 3} className="fill-[#38bdf8] text-[9px]">{formatValue(powerRange.min)} kW</text>
          {temperatureRange != null ? (
            <>
              <text x={STD_CHART.plotRight} y="12" textAnchor="end" className="fill-[#fb923c] text-[9px]">{formatValue(temperatureRange.max)} °C</text>
              <text x={STD_CHART.plotRight} y={STD_CHART.plotBottom - 3} textAnchor="end" className="fill-[#fb923c] text-[9px]">{formatValue(temperatureRange.min)} °C</text>
            </>
          ) : null}
          {powerPaths.map((path, index) => <path key={`power-${index}`} d={path} fill="none" stroke={POWER_COLOR} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />)}
          {temperaturePaths.map((path, index) => <path key={`temperature-${index}`} d={path} fill="none" stroke={TEMPERATURE_COLOR} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />)}
          {powerMarkers.map((point, index) => <circle key={`power-point-${point.time}-${index}`} cx={x(point.time)} cy={yFor(point.powerKw!, powerRange)} r="1.75" fill={POWER_COLOR} />)}
          {temperatureRange != null ? temperatureMarkers.map((point, index) => <circle key={`temperature-point-${point.time}-${index}`} cx={x(point.time)} cy={yFor(point.batteryTempC!, temperatureRange)} r="1.75" fill={TEMPERATURE_COLOR} />) : null}
          {hovered ? <ChartHoverCrosshair snapX={x(hovered.time)} plotTop={STD_CHART.plotTop} plotBottom={STD_CHART.plotBottom} /> : null}
          {hovered?.powerKw != null ? <circle cx={x(hovered.time)} cy={yFor(hovered.powerKw, powerRange)} r="3.5" fill={POWER_COLOR} /> : null}
          {hovered?.batteryTempC != null && temperatureRange != null ? <circle cx={x(hovered.time)} cy={yFor(hovered.batteryTempC, temperatureRange)} r="3.5" fill={TEMPERATURE_COLOR} /> : null}
        </svg>
      </InteractiveChartShell>

      <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-[#38bdf8]" />{tx("vehicle.telemetry.chargePower")} · kW</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-[#fb923c]" />{tx("vehicle.telemetry.batteryTemp")} · °C</span>
      </div>
      {!fullscreen ? (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogContent className="max-h-[calc(100dvh-1rem)] max-w-[calc(100vw-1rem)] overflow-y-auto p-3 sm:max-w-[calc(100vw-2rem)]">
            <DialogTitle className="sr-only">{tx("charging.powerTemperatureTimeline")}</DialogTitle>
            <PowerTemperaturePlot points={points} locale={locale} tx={tx} fullscreen />
          </DialogContent>
        </Dialog>
      ) : null}
    </article>
  );
}
