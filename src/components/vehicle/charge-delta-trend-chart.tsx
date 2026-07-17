"use client";

import { useState, type PointerEvent } from "react";

import { chartTooltipTransform } from "@/components/vehicle/chart-interaction";
import type { ChargeDeltaTrend, ChargeDeltaTrendPoint } from "@/lib/bydmate/charge-delta-trend";
import type { TranslationKey } from "@/lib/i18n";

const VIEW_W = 340;
const VIEW_H = 148;
const PLOT_LEFT = 40;
const PLOT_RIGHT = 318;
const PLOT_TOP = 16;
const PLOT_BOTTOM = 100;
/** Partial charges live on their own rail below the axis — they share the time scale, not the delta scale. */
const MARK_RAIL_Y = 112;

type Translator = (key: TranslationKey, values?: Record<string, string | number>) => string;

/** Deltas are millivolt-scale; mV keeps the axis readable without leading zeros. */
function toMv(deltaV: number) {
  return deltaV * 1000;
}

export function ChargeDeltaTrendChart({
  trend,
  locale,
  tx,
}: {
  trend: ChargeDeltaTrend;
  locale: string;
  tx: Translator;
}) {
  const [hovered, setHovered] = useState<ChargeDeltaTrendPoint | null>(null);

  const { fullCharges, partialCharges } = trend;

  // The time axis spans everything that happened, so the partial-charge marks sit
  // between the full charges they actually preceded.
  const allTimes = [...fullCharges.map((p) => p.time), ...partialCharges.map((p) => p.time)];
  const minTime = Math.min(...allTimes);
  const maxTime = Math.max(...allTimes);

  const deltas = fullCharges.map((p) => toMv(p.deltaV));
  const minDelta = Math.min(...deltas);
  const maxDelta = Math.max(...deltas);
  const pad = Math.max((maxDelta - minDelta) * 0.2, 2);
  const yMin = Math.max(0, minDelta - pad);
  const yMax = maxDelta + pad;

  const xFn = (time: number) => {
    if (maxTime === minTime) return (PLOT_LEFT + PLOT_RIGHT) / 2;
    return PLOT_LEFT + ((time - minTime) / (maxTime - minTime)) * (PLOT_RIGHT - PLOT_LEFT);
  };
  const yFn = (mv: number) => {
    if (yMax === yMin) return (PLOT_TOP + PLOT_BOTTOM) / 2;
    return PLOT_BOTTOM - ((mv - yMin) / (yMax - yMin)) * (PLOT_BOTTOM - PLOT_TOP);
  };

  const pathD = fullCharges
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xFn(p.time).toFixed(1)} ${yFn(toMv(p.deltaV)).toFixed(1)}`)
    .join(" ");

  const latest = fullCharges[fullCharges.length - 1];
  const dateFmt = (ms: number) =>
    new Date(ms).toLocaleDateString(locale, { month: "short", day: "numeric" });

  const yTicks = [yMax, (yMin + yMax) / 2, yMin];
  const xTicks = maxTime === minTime ? [minTime] : [minTime, (minTime + maxTime) / 2, maxTime];

  const handlePointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width <= 0) return;
    const svgX = ((event.clientX - bounds.left) / bounds.width) * VIEW_W;
    const nearest = fullCharges.reduce((closest, point) =>
      Math.abs(xFn(point.time) - svgX) < Math.abs(xFn(closest.time) - svgX) ? point : closest,
    );
    setHovered(nearest);
  };

  return (
    <div className="relative">
      <svg
        className="h-48 w-full touch-none overflow-visible"
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        role="img"
        aria-label={tx("vehicle.analytics.cellDeltaTitle")}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setHovered(null)}
      >
        <line
          x1={PLOT_LEFT}
          x2={PLOT_RIGHT}
          y1={PLOT_BOTTOM}
          y2={PLOT_BOTTOM}
          stroke="currentColor"
          className="text-border"
          strokeWidth="1"
        />
        <line
          x1={PLOT_LEFT}
          x2={PLOT_LEFT}
          y1={PLOT_TOP}
          y2={PLOT_BOTTOM}
          stroke="currentColor"
          className="text-border"
          strokeWidth="1"
        />
        {yTicks.map((tick) => (
          <g key={tick}>
            <line
              x1={PLOT_LEFT}
              x2={PLOT_RIGHT}
              y1={yFn(tick)}
              y2={yFn(tick)}
              stroke="currentColor"
              className="text-border/40"
              strokeWidth="1"
              strokeDasharray="4 6"
            />
            <text
              x={PLOT_LEFT - 5}
              y={yFn(tick) + 3}
              textAnchor="end"
              fontSize="9"
              className="fill-muted-foreground"
            >
              {tick.toFixed(0)}
            </text>
          </g>
        ))}
        {xTicks.map((time) => (
          <text
            key={time}
            x={xFn(time)}
            y={VIEW_H - 4}
            textAnchor="middle"
            fontSize="9"
            className="fill-muted-foreground"
          >
            {dateFmt(time)}
          </text>
        ))}

        {fullCharges.length > 1 ? (
          <path
            d={pathD}
            fill="none"
            stroke="#38bdf8"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.85"
          />
        ) : null}

        {hovered ? (
          <line
            x1={xFn(hovered.time)}
            x2={xFn(hovered.time)}
            y1={PLOT_TOP}
            y2={PLOT_BOTTOM}
            stroke="#facc15"
            strokeWidth="1"
            opacity="0.65"
            strokeDasharray="3 4"
          />
        ) : null}

        {fullCharges.map((point) => (
          <circle
            key={point.sessionId}
            cx={xFn(point.time)}
            cy={yFn(toMv(point.deltaV))}
            r={point === hovered || point === latest ? 4.5 : 3}
            fill="#38bdf8"
          />
        ))}

        {partialCharges.map((mark) => (
          <rect
            key={mark.sessionId}
            x={xFn(mark.time) - 1.25}
            y={MARK_RAIL_Y - 3}
            width="2.5"
            height="6"
            rx="1"
            className="fill-muted-foreground"
            opacity="0.55"
          />
        ))}
      </svg>

      {hovered ? (
        <div
          className={`pointer-events-none absolute z-10 min-w-40 rounded-xl border border-border bg-popover/95 p-3 text-xs text-popover-foreground shadow-xl ${chartTooltipTransform(
            "auto",
            xFn(hovered.time),
            yFn(toMv(hovered.deltaV)),
            VIEW_W,
            VIEW_H,
          )}`}
          style={{
            left: `${(xFn(hovered.time) / VIEW_W) * 100}%`,
            top: `${(yFn(toMv(hovered.deltaV)) / VIEW_H) * 100}%`,
          }}
        >
          <p className="font-heading text-sm font-semibold tabular-nums">
            {toMv(hovered.deltaV).toFixed(0)} mV
          </p>
          <p className="mt-1 text-muted-foreground">
            {new Date(hovered.time).toLocaleDateString(locale, {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </p>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-muted-foreground">SOC</dt>
            <dd className="text-right font-mono">{hovered.deltaSoc.toFixed(0)}%</dd>
            {hovered.sohPercent != null ? (
              <>
                <dt className="text-muted-foreground">SOH</dt>
                <dd className="text-right font-mono">{hovered.sohPercent.toFixed(1)}%</dd>
              </>
            ) : null}
            {hovered.partialChargesSincePrevious > 0 ? (
              <>
                <dt className="text-muted-foreground">
                  {tx("vehicle.analytics.cellDeltaPartialCharge")}
                </dt>
                <dd className="text-right font-mono">{hovered.partialChargesSincePrevious}</dd>
              </>
            ) : null}
          </dl>
        </div>
      ) : null}

      <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-[#38bdf8]" />
          {tx("vehicle.analytics.cellDeltaFullCharge")}
        </span>
        {partialCharges.length > 0 ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-[3px] rounded-sm bg-muted-foreground/55" />
            {tx("vehicle.analytics.cellDeltaPartialCharge")}
          </span>
        ) : null}
      </div>
    </div>
  );
}
