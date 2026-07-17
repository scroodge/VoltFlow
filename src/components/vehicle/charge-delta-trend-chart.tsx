"use client";

import { useState, type PointerEvent } from "react";

import { chartTooltipTransform } from "@/components/vehicle/chart-interaction";
import type { ChargeDeltaTrendPoint } from "@/lib/bydmate/charge-delta-trend";
import type { TranslationKey } from "@/lib/i18n";

const VIEW_W = 340;
const VIEW_H = 140;
const PLOT_LEFT = 38;
const PLOT_RIGHT = 318;
const PLOT_TOP = 16;
const PLOT_BOTTOM = 104;

type Translator = (key: TranslationKey, values?: Record<string, string | number>) => string;

export function ChargeDeltaTrendChart({
  points,
  locale,
  tx,
}: {
  points: ChargeDeltaTrendPoint[];
  locale: string;
  tx: Translator;
}) {
  const [hovered, setHovered] = useState<ChargeDeltaTrendPoint | null>(null);

  const minTime = Math.min(...points.map((p) => p.time));
  const maxTime = Math.max(...points.map((p) => p.time));
  const minDelta = Math.min(...points.map((p) => p.deltaV));
  const maxDelta = Math.max(...points.map((p) => p.deltaV));
  const pad = Math.max((maxDelta - minDelta) * 0.2, 0.002);
  const yMin = Math.max(0, minDelta - pad);
  const yMax = maxDelta + pad;

  const xFn = (time: number) => {
    if (maxTime === minTime) return (PLOT_LEFT + PLOT_RIGHT) / 2;
    return PLOT_LEFT + ((time - minTime) / (maxTime - minTime)) * (PLOT_RIGHT - PLOT_LEFT);
  };
  const yFn = (delta: number) => {
    if (yMax === yMin) return (PLOT_TOP + PLOT_BOTTOM) / 2;
    return PLOT_BOTTOM - ((delta - yMin) / (yMax - yMin)) * (PLOT_BOTTOM - PLOT_TOP);
  };

  const pathD = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xFn(p.time).toFixed(1)} ${yFn(p.deltaV).toFixed(1)}`)
    .join(" ");

  const latest = points[points.length - 1];
  const dateFmt = (ms: number) =>
    new Date(ms).toLocaleDateString(locale, { month: "short", day: "numeric" });

  const yTicks = [yMax, (yMin + yMax) / 2, yMin];
  const xTicks = points.length > 1 ? [minTime, (minTime + maxTime) / 2, maxTime] : [minTime];

  const handlePointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width <= 0) return;
    const svgX = ((event.clientX - bounds.left) / bounds.width) * VIEW_W;
    const nearest = points.reduce((closest, point) =>
      Math.abs(xFn(point.time) - svgX) < Math.abs(xFn(closest.time) - svgX) ? point : closest,
    );
    setHovered(nearest);
  };

  return (
    <div className="relative">
      <svg
        className="h-44 w-full touch-none overflow-visible"
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
              {tick.toFixed(3)}
            </text>
          </g>
        ))}
        {xTicks.map((time) => (
          <g key={time}>
            <line
              x1={xFn(time)}
              x2={xFn(time)}
              y1={PLOT_BOTTOM}
              y2={PLOT_BOTTOM + 5}
              stroke="currentColor"
              className="text-border"
              strokeWidth="1"
            />
            <text
              x={xFn(time)}
              y={PLOT_BOTTOM + 18}
              textAnchor="middle"
              fontSize="9"
              className="fill-muted-foreground"
            >
              {dateFmt(time)}
            </text>
          </g>
        ))}
        {points.length > 1 ? (
          <path
            d={pathD}
            fill="none"
            stroke="#38bdf8"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.8"
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
        {/* Filled = charged into the balance tail, hollow = partial charge. */}
        {points.map((point) => (
          <circle
            key={point.sessionId}
            cx={xFn(point.time)}
            cy={yFn(point.deltaV)}
            r={point === hovered || point === latest ? 4.5 : 3}
            fill={point.isFullCharge ? "#38bdf8" : "var(--voltflow-card)"}
            stroke="#38bdf8"
            strokeWidth="1.5"
          />
        ))}
      </svg>

      {hovered ? (
        <div
          className={`pointer-events-none absolute z-10 min-w-40 rounded-xl border border-border bg-popover/95 p-3 text-xs text-popover-foreground shadow-xl ${chartTooltipTransform(
            "auto",
            xFn(hovered.time),
            yFn(hovered.deltaV),
            VIEW_W,
            VIEW_H,
          )}`}
          style={{
            left: `${(xFn(hovered.time) / VIEW_W) * 100}%`,
            top: `${(yFn(hovered.deltaV) / VIEW_H) * 100}%`,
          }}
        >
          <p className="font-heading text-sm font-semibold tabular-nums">
            {hovered.deltaV.toFixed(3)} V
          </p>
          <p className="mt-1 text-muted-foreground">
            {new Date(hovered.time).toLocaleDateString(locale, {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </p>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-muted-foreground">
              {hovered.isFullCharge
                ? tx("vehicle.analytics.cellDeltaFullCharge")
                : tx("vehicle.analytics.cellDeltaPartialCharge")}
            </dt>
            <dd className="text-right font-mono">{hovered.endSoc.toFixed(0)}%</dd>
            {hovered.deltaSoc != null ? (
              <>
                <dt className="text-muted-foreground">SOC</dt>
                <dd className="text-right font-mono">
                  {tx("vehicle.analytics.cellDeltaAtSoc", {
                    value: hovered.deltaSoc.toFixed(0),
                  })}
                </dd>
              </>
            ) : null}
            {hovered.sohPercent != null ? (
              <>
                <dt className="text-muted-foreground">SOH</dt>
                <dd className="text-right font-mono">{hovered.sohPercent.toFixed(1)}%</dd>
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
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full border-[1.5px] border-[#38bdf8]" />
          {tx("vehicle.analytics.cellDeltaPartialCharge")}
        </span>
      </div>
    </div>
  );
}
