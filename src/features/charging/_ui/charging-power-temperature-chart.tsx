"use client";

import type { PointerEvent } from "react";
import { useMemo, useState } from "react";
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
