"use client";

import type { ReactNode } from "react";

export const STD_CHART = {
  width: 340,
  height: 158,
  plotLeft: 34,
  plotRight: 318,
  plotTop: 16,
  plotBottom: 104,
} as const;

export const DELTA_SOC_CHART = {
  width: 320,
  height: 142,
  plotLeft: 24,
  plotRight: 296,
  plotTop: 18,
  plotBottom: 110,
} as const;

/** Break line charts when telemetry gaps exceed this (missing Cloud Sync batches). */
export const CHART_LINE_GAP_MS = 5_000;

/** Gap threshold for line segments — scales up for downsampled day timelines. */
export function chartLineGapMs(
  medianGapSeconds: number | null,
  minTime?: number,
  maxTime?: number,
  pointCount?: number,
): number {
  if (medianGapSeconds != null && medianGapSeconds > 0) {
    return Math.max(CHART_LINE_GAP_MS, medianGapSeconds * 1000 * 1.5);
  }
  if (
    minTime != null &&
    maxTime != null &&
    pointCount != null &&
    pointCount > 1 &&
    maxTime > minTime
  ) {
    const avgGapMs = (maxTime - minTime) / (pointCount - 1);
    return Math.max(CHART_LINE_GAP_MS, avgGapMs * 1.5);
  }
  return CHART_LINE_GAP_MS;
}

export function splitByTimeGap<T extends { time: number }>(
  points: T[],
  maxGapMs = CHART_LINE_GAP_MS,
): T[][] {
  if (points.length === 0) return [];

  const segments: T[][] = [];
  let current: T[] = [points[0]!];

  for (let index = 1; index < points.length; index += 1) {
    const point = points[index]!;
    const previous = points[index - 1]!;
    if (point.time - previous.time > maxGapMs) {
      segments.push(current);
      current = [point];
    } else {
      current.push(point);
    }
  }

  segments.push(current);
  return segments;
}

export function buildBrokenLinePaths<T extends { time: number }>(
  points: T[],
  mapPoint: (point: T) => { x: number; y: number },
  maxGapMs = CHART_LINE_GAP_MS,
): string[] {
  return splitByTimeGap(points, maxGapMs)
    .filter((segment) => segment.length > 1)
    .map((segment) =>
      segment
        .map((point, index) => {
          const { x, y } = mapPoint(point);
          return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
        })
        .join(" "),
    );
}

export function clientToSvg(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
  viewBoxWidth: number,
  viewBoxHeight: number,
) {
  const rect = svg.getBoundingClientRect();
  return {
    x: ((clientX - rect.left) / rect.width) * viewBoxWidth,
    y: ((clientY - rect.top) / rect.height) * viewBoxHeight,
  };
}

export function nearestIndexByX(svgX: number, xValues: number[]) {
  if (xValues.length === 0) return -1;

  let bestIndex = 0;
  let bestDistance = Math.abs(xValues[0] - svgX);
  for (let index = 1; index < xValues.length; index += 1) {
    const distance = Math.abs(xValues[index] - svgX);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }

  return bestIndex;
}

export function nearestPointByTime<T extends { time: number }>(points: T[], time: number) {
  if (points.length === 0) return null;

  let best = points[0];
  let bestDistance = Math.abs(points[0].time - time);
  for (const point of points) {
    const distance = Math.abs(point.time - time);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = point;
    }
  }

  return best;
}

export function ChartHoverCrosshair({
  snapX,
  plotTop,
  plotBottom,
}: {
  snapX: number;
  plotTop: number;
  plotBottom: number;
}) {
  return (
    <line
      x1={snapX}
      x2={snapX}
      y1={plotTop}
      y2={plotBottom}
      stroke="currentColor"
      className="text-primary/70"
      strokeWidth="1"
      strokeDasharray="4 4"
      pointerEvents="none"
    />
  );
}

export function ChartDataTooltip({
  title,
  rows,
  viewBoxX,
  viewBoxY,
  viewBoxWidth,
  viewBoxHeight,
}: {
  title?: string;
  rows: Array<{ label: string; value: string; color?: string }>;
  viewBoxX: number;
  viewBoxY: number;
  viewBoxWidth: number;
  viewBoxHeight: number;
}) {
  const left = (viewBoxX / viewBoxWidth) * 100;
  const top = (viewBoxY / viewBoxHeight) * 100;

  return (
    <div
      className="pointer-events-none absolute z-10 min-w-[8rem] -translate-x-1/2 -translate-y-[calc(100%+0.5rem)] rounded-lg border border-border bg-background/95 px-2.5 py-1.5 text-[11px] shadow-lg backdrop-blur"
      style={{ left: `${left}%`, top: `${top}%` }}
    >
      {title ? <p className="font-semibold text-foreground">{title}</p> : null}
      <dl className={title ? "mt-1 space-y-0.5" : "space-y-0.5"}>
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3">
            <dt className="inline-flex items-center gap-1.5 text-muted-foreground">
              {row.color ? (
                <span className="size-1.5 rounded-full" style={{ backgroundColor: row.color }} aria-hidden />
              ) : null}
              {row.label}
            </dt>
            <dd className="font-medium text-foreground">{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function InteractiveChartShell({
  heightClass,
  interactive,
  tooltip,
  children,
}: {
  heightClass: string;
  interactive: boolean;
  tooltip: ReactNode;
  children: ReactNode;
}) {
  if (!interactive) {
    return <>{children}</>;
  }

  return (
    <div className={`relative ${heightClass}`}>
      {children}
      {tooltip}
    </div>
  );
}
