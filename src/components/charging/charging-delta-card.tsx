"use client";

import { Maximize2, Minus, Plus } from "lucide-react";
import type { PointerEvent } from "react";
import { useId, useMemo, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { chartTooltipTransform } from "@/components/vehicle/chart-interaction";
import { Skeleton } from "@/components/ui/skeleton";
import { useBydmateChargingSessionSamplesQuery, type ChargingSessionTelemetrySample } from "@/hooks/use-bydmate-charging-session-samples-query";
import type { ChargingSessionRow } from "@/types/database";

type DeltaPoint = {
  soc: number;
  delta: number;
  maxCellVoltage: number | null;
  time: number;
};

type DeltaZoomMode = "full" | "top";

function validNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sampleSoc(sample: ChargingSessionTelemetrySample) {
  return validNumber(sample.telemetry.soc) ?? validNumber(sample.diplus?.soc);
}

function sampleDelta(sample: ChargingSessionTelemetrySample) {
  const stored =
    validNumber(sample.diplus_cell_delta_v) ??
    validNumber(sample.telemetry.diplus_cell_delta_v) ??
    validNumber(sample.telemetry.cell_delta_v) ??
    validNumber(sample.diplus?.cell_delta_v);
  if (stored != null) return stored;

  const min =
    validNumber(sample.diplus_min_cell_voltage_v) ??
    validNumber(sample.telemetry.diplus_min_cell_voltage_v) ??
    validNumber(sample.telemetry.cell_voltage_min_v) ??
    validNumber(sample.diplus?.min_cell_voltage_v);
  const max =
    validNumber(sample.diplus_max_cell_voltage_v) ??
    validNumber(sample.telemetry.diplus_max_cell_voltage_v) ??
    validNumber(sample.telemetry.cell_voltage_max_v) ??
    validNumber(sample.diplus?.max_cell_voltage_v);

  return min != null && max != null ? max - min : null;
}

function sampleMaxCellVoltage(sample: ChargingSessionTelemetrySample) {
  return validNumber(sample.diplus_max_cell_voltage_v) ??
    validNumber(sample.telemetry.diplus_max_cell_voltage_v) ??
    validNumber(sample.telemetry.cell_voltage_max_v) ??
    validNumber(sample.diplus?.max_cell_voltage_v);
}

function preparePoints(samples: ChargingSessionTelemetrySample[]) {
  return samples
    .flatMap((sample) => {
      const soc = sampleSoc(sample);
      const delta = sampleDelta(sample);
      const time = Date.parse(sample.device_time);

      return soc != null && delta != null && Number.isFinite(time)
        ? [{ soc, delta, maxCellVoltage: sampleMaxCellVoltage(sample), time }]
        : [];
    })
    .sort((a, b) => a.time - b.time);
}

function smoothDeltaPoints(points: DeltaPoint[]) {
  if (points.length < 9) return points;

  const windowRadius = points.length > 120 ? 6 : 3;
  return points.map((point, index) => {
    const from = Math.max(0, index - windowRadius);
    const to = Math.min(points.length, index + windowRadius + 1);
    const values = points
      .slice(from, to)
      .map((candidate) => candidate.delta)
      .sort((a, b) => a - b);
    const middle = Math.floor(values.length / 2);
    const delta =
      values.length % 2 === 0
        ? (values[middle - 1] + values[middle]) / 2
        : values[middle];

    return { ...point, delta };
  });
}

export function ChargingDeltaCard({
  session,
  vehicleId,
}: {
  session: ChargingSessionRow;
  vehicleId?: string | null;
}) {
  const resolvedVehicleId = vehicleId?.trim() || null;
  const { data = [], isLoading, error } = useBydmateChargingSessionSamplesQuery(
    session.id,
    resolvedVehicleId,
    session.status,
  );
  const points = useMemo(() => preparePoints(data), [data]);

  if (isLoading) {
    return <Skeleton className="h-72 rounded-3xl" />;
  }

  if (error || points.length === 0) {
    return (
      <article className="rounded-3xl border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-heading text-lg font-semibold tracking-tight">Delta by SOC</h2>
            <p className="mt-1 text-xs text-muted-foreground">{resolvedVehicleId ?? "auto"} · charge path 0-100% SOC</p>
          </div>
          <span className="rounded-full border border-border bg-white/[0.03] px-3 py-1 text-xs uppercase tracking-[0.16em] text-muted-foreground">
            0 pts
          </span>
        </div>
        <div className="mt-5 rounded-2xl border border-border bg-background/30 p-4 text-sm leading-6 text-muted-foreground">
          Нет реальных BYDMate точек для этой сессии. Если во время зарядки приходят данные, график появится здесь.
        </div>
      </article>
    );
  }

  return <DeltaPlot points={points} vehicleId={resolvedVehicleId ?? "auto"} />;
}

function DeltaPlot({
  points,
  vehicleId,
  isFullscreen = false,
}: {
  points: DeltaPoint[];
  vehicleId: string;
  isFullscreen?: boolean;
}) {
  const clipId = useId();
  const [zoomMode, setZoomMode] = useState<DeltaZoomMode>("full");
  const [hoveredPoint, setHoveredPoint] = useState<DeltaPoint | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
  const [isFullscreenOpen, setIsFullscreenOpen] = useState(false);
  const topPoints = useMemo(
    () => points.filter((point) => point.soc >= 99 && point.soc <= 100),
    [points],
  );
  const plotPoints = zoomMode === "top" && topPoints.length > 0 ? topPoints : points;
  const smoothedPoints = useMemo(() => smoothDeltaPoints(plotPoints), [plotPoints]);
  const latest = plotPoints.at(-1) ?? null;
  const peakMaxCellPoint = plotPoints.reduce<DeltaPoint | null>((peak, point) => {
    if (point.maxCellVoltage == null) return peak;
    if (peak?.maxCellVoltage == null) return point;
    return point.maxCellVoltage > peak.maxCellVoltage ? point : peak;
  }, null);
  const minSoc = Math.min(...plotPoints.map((point) => point.soc));
  const maxSoc = Math.max(...plotPoints.map((point) => point.soc));
  const minDelta = Math.min(...plotPoints.map((point) => point.delta));
  const maxDelta = Math.max(...plotPoints.map((point) => point.delta));
  const minTime = Math.min(...plotPoints.map((point) => point.time));
  const maxTime = Math.max(...plotPoints.map((point) => point.time));
  const deltaPad = Math.max((maxDelta - minDelta) * 0.14, 0.005);
  const yMin = Math.max(0, minDelta - deltaPad);
  const yMax = maxDelta + deltaPad;
  const chartHeightClass = isFullscreen ? "h-[min(68vh,760px)]" : "h-52";

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
  const deltaPath = smoothedPoints
    .map((point, index) => `${index === 0 ? "M" : "L"} ${x(point.time).toFixed(2)} ${y(point.delta).toFixed(2)}`)
    .join(" ");
  const socPath = plotPoints
    .map((point, index) => `${index === 0 ? "M" : "L"} ${x(point.time).toFixed(2)} ${socY(point.soc).toFixed(2)}`)
    .join(" ");
  const markers = plotPoints.length <= 160 ? plotPoints : hoveredPoint ? [hoveredPoint] : [];
  const canZoomTop = topPoints.length > 0;

  const handlePointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const svgX = ((event.clientX - bounds.left) / bounds.width) * 320;
    const nearest = plotPoints.reduce<DeltaPoint | null>((closest, point) => {
      if (!closest) return point;
      return Math.abs(x(point.time) - svgX) < Math.abs(x(closest.time) - svgX)
        ? point
        : closest;
    }, null);
    if (!nearest) return;
    setHoveredPoint(nearest);
    setTooltipPosition({
      x: Math.min(92, Math.max(8, (x(nearest.time) / 320) * 100)),
      y: Math.min(82, Math.max(8, (y(nearest.delta) / 142) * 100)),
    });
  };

  return (
    <article className={`rounded-3xl border border-border bg-card p-5 ${isFullscreen ? "flex min-h-0 flex-1 flex-col" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-lg font-semibold tracking-tight">Delta by SOC</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {vehicleId} · {zoomMode === "top" && canZoomTop ? "99-100% SOC focus" : "charge path 0-100% SOC"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="rounded-full border border-border bg-white/[0.03] px-3 py-1 text-xs uppercase tracking-[0.16em] text-muted-foreground">
            {plotPoints.length} pts
          </span>
          {!isFullscreen ? (
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              title="Open full screen"
              aria-label="Open full screen"
              onClick={() => setIsFullscreenOpen(true)}
            >
              <Maximize2 className="size-4" aria-hidden />
            </Button>
          ) : null}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-xl border border-border bg-background/30 p-1">
          <Button
            type="button"
            size="sm"
            variant={zoomMode === "full" ? "secondary" : "ghost"}
            className="h-8 rounded-lg"
            onClick={() => setZoomMode("full")}
          >
            <Minus className="size-3.5" aria-hidden />
            Full
          </Button>
          <Button
            type="button"
            size="sm"
            variant={zoomMode === "top" ? "secondary" : "ghost"}
            className="h-8 rounded-lg"
            disabled={!canZoomTop}
            onClick={() => setZoomMode("top")}
          >
            <Plus className="size-3.5" aria-hidden />
            99-100
          </Button>
        </div>
        <span className="text-xs text-muted-foreground">
          {canZoomTop ? `${topPoints.length} pts in 99-100%` : "No 99-100% points"}
        </span>
      </div>

      <div className={`relative mt-4 ${chartHeightClass}`}>
        <svg
          className="h-full w-full overflow-hidden touch-none"
          viewBox="0 0 320 142"
          role="img"
          aria-label="Charging cell delta by SOC"
          onPointerMove={handlePointerMove}
          onPointerLeave={() => setHoveredPoint(null)}
        >
          <defs>
            <clipPath id={clipId}>
              <rect x="24" y="18" width="272" height="92" />
            </clipPath>
          </defs>
          <rect x="24" y="18" width="272" height="92" fill="transparent" />
          <line x1="24" x2="296" y1="110" y2="110" stroke="currentColor" className="text-border" strokeWidth="1" />
          <line x1="24" x2="24" y1="18" y2="110" stroke="currentColor" className="text-border" strokeWidth="1" />
          <line x1="24" x2="296" y1="64" y2="64" stroke="currentColor" className="text-border/70" strokeWidth="1" strokeDasharray="4 6" />
          <text x="24" y="132" className="fill-muted-foreground text-[10px]">{formatPlotTime(minTime)}</text>
          <text x="296" y="132" textAnchor="end" className="fill-muted-foreground text-[10px]">{formatPlotTime(maxTime)}</text>
          <text x="30" y="14" className="fill-muted-foreground text-[10px]">{maxDelta.toFixed(3)} V</text>
          <text x="30" y="106" className="fill-muted-foreground text-[10px]">{minDelta.toFixed(3)} V</text>
          <text x="296" y="14" textAnchor="end" className="fill-primary text-[10px]">{maxSoc.toFixed(0)}% SOC</text>
          <text x="296" y="106" textAnchor="end" className="fill-primary text-[10px]">{minSoc.toFixed(0)}% SOC</text>
          <g clipPath={`url(#${clipId})`}>
            {plotPoints.length > 1 ? (
              <path d={socPath} fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.78" strokeDasharray="3 5" />
            ) : null}
            {plotPoints.length > 1 ? (
              <path d={deltaPath} fill="none" stroke="#38bdf8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.78" />
            ) : null}
            {hoveredPoint ? (
              <line
                x1={x(hoveredPoint.time)}
                x2={x(hoveredPoint.time)}
                y1="18"
                y2="110"
                stroke="#facc15"
                strokeWidth="1"
                opacity="0.65"
                strokeDasharray="3 4"
              />
            ) : null}
            {markers.map((point, index) => (
              <circle
                key={`${point.time}-${index}`}
                cx={x(point.time)}
                cy={y(point.delta)}
                r={point === latest || point === hoveredPoint ? 4 : 3}
                fill={point === hoveredPoint ? "#facc15" : point === latest ? "#facc15" : "#fb7185"}
                opacity={point === hoveredPoint || point === latest ? 1 : 0.78}
              />
            ))}
          </g>
        </svg>
        {hoveredPoint ? (
          <div
            className={`pointer-events-none absolute z-10 min-w-40 rounded-xl border border-border bg-popover/95 p-3 text-xs text-popover-foreground shadow-xl ${chartTooltipTransform(
              "auto",
              (tooltipPosition.x / 100) * 320,
              (tooltipPosition.y / 100) * 142,
              320,
              142,
            )}`}
            style={{
              left: `${tooltipPosition.x}%`,
              top: `${tooltipPosition.y}%`,
            }}
          >
            <p className="font-heading text-sm font-semibold tabular-nums">
              {hoveredPoint.soc.toFixed(0)}% SOC
            </p>
            <p className="mt-1 text-muted-foreground">{formatPlotTime(hoveredPoint.time)}</p>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt className="text-muted-foreground">Max cell</dt>
              <dd className="text-right font-mono">{fmtNumber(hoveredPoint.maxCellVoltage, 3)} V</dd>
              <dt className="text-muted-foreground">Delta</dt>
              <dd className="text-right font-mono">{hoveredPoint.delta.toFixed(3)} V</dd>
            </dl>
          </div>
        ) : null}
      </div>

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

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <DeltaStat label="SOC" value={`${minSoc.toFixed(0)}-${maxSoc.toFixed(0)}%`} />
        <DeltaStat label="Delta" value={`${minDelta.toFixed(3)}-${maxDelta.toFixed(3)} V`} />
        <DeltaStat label="Latest" value={latest ? `${latest.soc.toFixed(0)}% / ${latest.delta.toFixed(3)} V` : "—"} />
        <DeltaStat
          label="Peak max cell"
          value={
            peakMaxCellPoint
              ? `${fmtNumber(peakMaxCellPoint.maxCellVoltage, 3)} V · ${peakMaxCellPoint.soc.toFixed(0)}%`
              : "—"
          }
        />
      </div>
      {!isFullscreen ? (
        <Dialog open={isFullscreenOpen} onOpenChange={setIsFullscreenOpen}>
          <DialogContent className="flex h-[calc(100dvh-1rem)] max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-2xl p-3 sm:max-w-[calc(100vw-2rem)]">
            <DialogTitle className="sr-only">Delta by SOC full screen</DialogTitle>
            <DeltaPlot points={points} vehicleId={vehicleId} isFullscreen />
          </DialogContent>
        </Dialog>
      ) : null}
    </article>
  );
}

function DeltaStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-background/30 p-3">
      <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-xs text-foreground">{value}</p>
    </div>
  );
}

function fmtNumber(value: number | null | undefined, digits = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "—";
}

function formatPlotTime(ms: number) {
  if (!Number.isFinite(ms)) return "—";
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
