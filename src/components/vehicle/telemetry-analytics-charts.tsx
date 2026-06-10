"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Maximize2, Loader2 } from "lucide-react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChartDataTooltip,
  ChartHoverCrosshair,
  InteractiveChartShell,
  STD_CHART,
  clientToSvg,
  nearestIndexByX,
} from "@/components/vehicle/chart-interaction";
import { useTranslation } from "@/hooks/use-translation";
import type { Locale, TranslationKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  aggregateTelemetryBuckets,
  type AnalyticsSummary,
  type TelemetryBucket,
  type TempConsumptionBucket,
} from "@/lib/bydmate/telemetry-buckets";
import type { TelemetryHistoryPoint } from "@/lib/bydmate/telemetry-history";
import type { ChargingSessionRow } from "@/types/database";
import type { TelemetryHistoryRange } from "@/lib/bydmate/telemetry-ranges";

type Translator = (key: TranslationKey, values?: Record<string, string | number>) => string;

function fmt(value: number | null | undefined, digits = 1) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "—";
}

function localeCode(locale: Locale) {
  return locale === "be" ? "be-BY" : locale === "ru" ? "ru-RU" : "en-US";
}

type SummaryStat = {
  id: string;
  labelKey: TranslationKey;
  value: string;
  unit?: string;
  accent?: boolean;
};

export function AnalyticsSummaryStats({
  summary,
  chargedKwh,
}: {
  summary: AnalyticsSummary;
  chargedKwh?: number | null;
}) {
  const { t } = useTranslation();
  const tx = t as Translator;

  const rawItems: Array<SummaryStat | null> = [
    { id: "trips", labelKey: "vehicle.analytics.summary.trips", value: String(summary.tripCount) },
    {
      id: "distance",
      labelKey: "vehicle.analytics.summary.distance",
      value: fmt(summary.distanceKm, 0),
      unit: "km",
      accent: true,
    },
    {
      id: "regen",
      labelKey: "vehicle.analytics.summary.regen",
      value: fmt(summary.regenKwh, 2),
      unit: "kWh",
      accent: true,
    },
    chargedKwh != null
      ? {
          id: "charged",
          labelKey: "vehicle.analytics.charged",
          value: fmt(chargedKwh, 1),
          unit: "kWh",
        }
      : null,
    summary.avgConsumptionKwh100 != null
      ? {
          id: "consumption",
          labelKey: "vehicle.analytics.summary.consumption",
          value: fmt(summary.avgConsumptionKwh100, 1),
          unit: "kWh/100",
          accent: true,
        }
      : null,
    summary.maxSpeedKmh != null
      ? {
          id: "maxSpeed",
          labelKey: "vehicle.analytics.summary.maxSpeed",
          value: fmt(summary.maxSpeedKmh, 0),
          unit: "km/h",
        }
      : null,
    summary.socSwing != null
      ? {
          id: "socSwing",
          labelKey: "vehicle.analytics.summary.socSwing",
          value: fmt(summary.socSwing, 0),
          unit: "%",
        }
      : null,
    {
      id: "telemetry",
      labelKey: "vehicle.analytics.summary.telemetry",
      value: String(summary.telemetryPoints),
    },
  ];

  const items = rawItems.filter((item): item is SummaryStat => {
    if (item == null) return false;
    if (item.value === "—") return false;
    return true;
  });

  if (items.length === 0) return null;

  return (
    <section className="mt-4" aria-label={tx("vehicle.analytics.summaryTitle")}>
      <p className="mb-2.5 text-xs font-medium text-muted-foreground">{tx("vehicle.analytics.summaryTitle")}</p>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((item) => (
          <div
            key={item.id}
            className={cn(
              "flex min-h-[4.75rem] min-w-0 flex-col justify-between rounded-2xl border p-3",
              item.accent
                ? "border-primary/20 bg-primary/[0.06]"
                : "border-border bg-white/[0.02]",
            )}
          >
            <p className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">{tx(item.labelKey)}</p>
            <p className="mt-2 font-heading text-xl font-bold leading-none tabular-nums tracking-tight">
              <span className="text-foreground">{item.value}</span>
              {item.unit ? (
                <span className="ml-1 text-[11px] font-semibold text-muted-foreground">{item.unit}</span>
              ) : null}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function AnalyticsSummaryStatsLoading() {
  const { t } = useTranslation();
  const tx = t as Translator;

  return (
    <section className="mt-4" aria-label={tx("vehicle.analytics.summaryTitle")} aria-busy="true">
      <p className="mb-2.5 text-xs font-medium text-muted-foreground">{tx("vehicle.analytics.summaryTitle")}</p>
      <div
        className="mb-3 flex items-start gap-3 rounded-2xl border border-border bg-white/[0.02] p-3"
        role="status"
        aria-live="polite"
      >
        <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-primary" aria-hidden />
        <div>
          <p className="text-sm font-medium">{tx("vehicle.analytics.summaryLoading")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{tx("vehicle.analytics.summaryLoadingHint")}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 6 }, (_, index) => (
          <div
            key={index}
            className="flex min-h-[4.75rem] min-w-0 flex-col justify-between rounded-2xl border border-border bg-white/[0.02] p-3"
          >
            <Skeleton className="h-3 w-16 rounded-md" />
            <Skeleton className="mt-2 h-6 w-12 rounded-md" />
          </div>
        ))}
      </div>
    </section>
  );
}

type BarSeries = {
  label: string;
  color: string;
  values: number[];
};

type BarChartModel = {
  title: string;
  unit: string;
  valueDigits: number;
  labels: string[];
  series: BarSeries[];
  bandMin?: number[];
  bandMax?: number[];
  subtitle?: string;
  referenceLine?: { value: number; label: string };
  /** Fixed Y-axis floor (e.g. 10 kWh/100 for efficiency). Bars anchor to this baseline. */
  yAxisMin?: number;
  /** Per-bucket text rendered inside bars (e.g. distance km). */
  barInsideText?: (string | null)[];
  barInsideLegend?: string;
};

function buildBarCharts(
  buckets: TelemetryBucket[],
  trips: { distance_km: number | null; avg_consumption_kwh_100km: number | null; started_at: string }[],
  range: TelemetryHistoryRange,
  locale: string,
  tx: Translator,
): BarChartModel[] {
  if (buckets.length === 0) return [];

  const labels = buckets.map((b) => b.label);

  // Mileage + efficiency from trips grouped by bucket — computed first so
  // the efficiency chart can appear at position [0] (most actionable insight)
  const granularity = range === "quarter" || range === "year" ? "week" : "day";
  const distanceByLabel = new Map<string, number>();
  const consumptionWeighted = new Map<string, { sum: number; weight: number }>();
  let periodConsumptionSum = 0;
  let periodConsumptionWeight = 0;

  for (const trip of trips) {
    const ms = Date.parse(trip.started_at);
    if (!Number.isFinite(ms)) continue;
    const d = new Date(ms);
    let key: string;
    if (granularity === "week") {
      const day = d.getUTCDay();
      const diff = day === 0 ? -6 : 1 - day;
      d.setUTCDate(d.getUTCDate() + diff);
      d.setUTCHours(0, 0, 0, 0);
      key = d.toLocaleDateString(locale, { month: "short", day: "numeric" });
    } else {
      key = d.toLocaleDateString(locale, { month: "short", day: "numeric" });
    }
    distanceByLabel.set(key, (distanceByLabel.get(key) ?? 0) + (trip.distance_km ?? 0));
    if (trip.avg_consumption_kwh_100km != null && trip.distance_km != null && trip.distance_km > 0) {
      periodConsumptionSum += trip.avg_consumption_kwh_100km * trip.distance_km;
      periodConsumptionWeight += trip.distance_km;
      const row = consumptionWeighted.get(key) ?? { sum: 0, weight: 0 };
      row.sum += trip.avg_consumption_kwh_100km * trip.distance_km;
      row.weight += trip.distance_km;
      consumptionWeighted.set(key, row);
    }
  }

  const periodAvgConsumption =
    periodConsumptionWeight > 0 ? periodConsumptionSum / periodConsumptionWeight : null;

  // Chart order: Efficiency → Mileage → Regen → Outside Temp
  const charts: BarChartModel[] = [
    {
      title: tx("vehicle.analytics.efficiencyTitle"),
      unit: "kWh/100",
      valueDigits: 1,
      yAxisMin: 10,
      labels,
      subtitle:
        periodAvgConsumption != null
          ? tx("vehicle.analytics.efficiencySubtitle", { value: fmt(periodAvgConsumption, 1) })
          : undefined,
      referenceLine:
        periodAvgConsumption != null
          ? { value: periodAvgConsumption, label: tx("vehicle.analytics.periodAverage") }
          : undefined,
      series: [{
        label: tx("vehicle.analytics.efficiencyBarLabel"),
        color: "#a78bfa",
        values: labels.map((label) => {
          const row = consumptionWeighted.get(label);
          return row && row.weight > 0 ? row.sum / row.weight : 0;
        }),
      }],
      barInsideText: labels.map((label) => {
        const km = distanceByLabel.get(label) ?? 0;
        return km > 0 ? `${fmt(km, 0)} km` : null;
      }),
      barInsideLegend: `${tx("vehicle.trips.distance")} · ${tx("vehicle.analytics.inBar")}`,
    },
    {
      title: tx("vehicle.analytics.mileageTitle"),
      unit: "km",
      valueDigits: 0,
      labels,
      series: [{
        label: tx("vehicle.trips.distance"),
        color: "var(--voltflow-cyan)",
        values: labels.map((label) => distanceByLabel.get(label) ?? 0),
      }],
    },
    {
      title: tx("vehicle.charts.regen"),
      unit: "kWh",
      valueDigits: 2,
      labels,
      series: [{ label: tx("vehicle.trips.regen"), color: "#34d399", values: buckets.map((b) => b.regenKwhSum) }],
    },
    {
      title: tx("vehicle.charts.outsideTemp"),
      unit: "°C",
      valueDigits: 1,
      labels,
      series: [
        { label: tx("vehicle.charts.outside"), color: "#38bdf8", values: buckets.map((b) => b.outsideTempAvg ?? 0) },
      ],
    },
  ];

  return charts.filter((chart) => {
    if (chart.bandMin && chart.bandMax) {
      return chart.bandMin.some((v) => v > 0) || chart.bandMax.some((v) => v > 0);
    }
    return chart.series.some((s) => s.values.some((v) => v > 0));
  });
}

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex size-9 items-center justify-center rounded-full border border-border bg-white/[0.03] text-muted-foreground transition hover:border-primary/50 hover:text-foreground disabled:opacity-45"
    >
      {children}
    </button>
  );
}

export function ChartSeriesLegend({
  series,
  referenceLine,
  barInsideLegend,
  unit,
  valueDigits = 1,
}: {
  series: { label: string; color: string }[];
  referenceLine?: { value: number; label: string };
  barInsideLegend?: string;
  unit?: string;
  valueDigits?: number;
}) {
  if (series.length === 0 && !referenceLine && !barInsideLegend) return null;

  return (
    <div className="flex flex-wrap items-center gap-3">
      {series.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="size-2 rounded-full" style={{ backgroundColor: item.color }} />
          {item.label}
        </span>
      ))}
      {barInsideLegend ? (
        <span className="text-xs text-muted-foreground">{barInsideLegend}</span>
      ) : null}
      {referenceLine ? (
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="inline-block h-0 w-4 border-t-2 border-dashed border-amber-300" aria-hidden />
          {referenceLine.label}: {fmt(referenceLine.value, valueDigits)}
          {unit ? ` ${unit}` : ""}
        </span>
      ) : null}
    </div>
  );
}

export function TelemetryBarChart({ chart }: { chart: BarChartModel }) {
  const { t } = useTranslation();
  const tx = t as Translator;
  const [isOpen, setIsOpen] = useState(false);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const { title, unit, valueDigits, labels, series, bandMin, bandMax, subtitle, referenceLine, barInsideText, barInsideLegend, yAxisMin } = chart;
  const count = labels.length;
  const hasBand = bandMin != null && bandMax != null;

  function buildScale(values: number[], digits: number, includeReference?: number | null) {
    const allValues = [
      ...values,
      ...(includeReference != null && includeReference > 0 ? [includeReference] : []),
    ].filter((v) => v > 0);
    const dataMin = allValues.length ? Math.min(...allValues) : 0;
    const dataMax = allValues.length ? Math.max(...allValues) : 1;
    const pad = Math.max((dataMax - dataMin) * 0.12, dataMax === dataMin ? 1 : 0);
    const yMin = yAxisMin ?? Math.max(0, dataMin - pad);
    const yMax = Math.max(yMin + 1, dataMax + pad);
    const yScale = (value: number) => {
      if (yMax === yMin) return 60;
      return 104 - ((value - yMin) / (yMax - yMin)) * 88;
    };
    const yTicks = [
      { label: fmt(yMax, digits), value: yMax },
      { label: fmt((yMin + yMax) / 2, digits), value: (yMin + yMax) / 2 },
      { label: fmt(yMin, digits), value: yMin },
    ];
    return { yMin, yMax, dataMin, dataMax, yScale, yTicks };
  }

  const primaryValues = [
    ...(hasBand ? [...(bandMin ?? []), ...(bandMax ?? [])] : []),
    ...series.flatMap((s) => s.values),
  ];
  const compactScale = buildScale(primaryValues, valueDigits);
  const fullScale = buildScale(
    primaryValues,
    valueDigits,
    referenceLine?.value ?? null,
  );
  const rangeSubtitle = `${fmt(compactScale.yMin, valueDigits)}–${fmt(compactScale.yMax, valueDigits)} ${unit}`;

  const slotCenter = (index: number) => {
    const slotW = 284 / Math.max(count, 1);
    return 34 + slotW * index + slotW / 2;
  };

  const plot = (
    heightClass: string,
    scale: ReturnType<typeof buildScale>,
    showReference: boolean,
    interactive = false,
  ) => {
    const handleMouseMove = (event: React.MouseEvent<SVGSVGElement>) => {
      const pointer = clientToSvg(event.currentTarget, event.clientX, event.clientY, STD_CHART.width, STD_CHART.height);
      if (pointer.x < STD_CHART.plotLeft || pointer.x > STD_CHART.plotRight || count === 0) {
        setHoverIndex(null);
        return;
      }
      const xCenters = labels.map((_, index) => slotCenter(index));
      setHoverIndex(nearestIndexByX(pointer.x, xCenters));
    };

    const hoveredLabel = hoverIndex == null ? null : labels[hoverIndex] ?? null;
    const tooltipRows =
      hoverIndex == null
        ? []
        : hasBand && bandMin && bandMax
          ? [
              {
                label: title,
                value: `${fmt(bandMin[hoverIndex] ?? 0, valueDigits)}–${fmt(bandMax[hoverIndex] ?? 0, valueDigits)} ${unit}`,
                color: "var(--voltflow-cyan)",
              },
            ]
          : series
              .map((item) => ({
                label: item.label,
                value: `${fmt(item.values[hoverIndex] ?? 0, valueDigits)} ${unit}`,
                color: item.color,
              }))
              .filter((row) => row.value !== `— ${unit}`);

    const svg = (
      <svg
        className={`${interactive ? "size-full" : heightClass} w-full overflow-visible ${interactive ? "cursor-crosshair" : ""}`}
        viewBox="0 0 340 158"
        role="img"
        aria-label={title}
        onMouseMove={interactive ? handleMouseMove : undefined}
        onMouseLeave={interactive ? () => setHoverIndex(null) : undefined}
      >
      <line x1="34" x2="318" y1="104" y2="104" stroke="currentColor" className="text-border" strokeWidth="1" />
      <line x1="34" x2="34" y1="16" y2="104" stroke="currentColor" className="text-border" strokeWidth="1" />
      {scale.yTicks.map((tick, index) => (
        <g key={`${title}-y-${index}`}>
          <line
            x1="34"
            x2="318"
            y1={scale.yScale(tick.value)}
            y2={scale.yScale(tick.value)}
            stroke="currentColor"
            className="text-border/60"
            strokeWidth="1"
            strokeDasharray="4 6"
          />
          <text x="29" y={scale.yScale(tick.value) + 3} textAnchor="end" className="fill-muted-foreground text-[8px]">
            {tick.label}
          </text>
        </g>
      ))}
      {showReference && referenceLine && referenceLine.value > 0 ? (
        <g>
          <line
            x1="34"
            x2="318"
            y1={scale.yScale(referenceLine.value)}
            y2={scale.yScale(referenceLine.value)}
            stroke="#fbbf24"
            strokeWidth="1.5"
            strokeDasharray="6 4"
            opacity="0.9"
          />
        </g>
      ) : null}
      {labels.map((label, index) => {
        const cx = slotCenter(index);
        const barW = Math.min((284 / Math.max(count, 1)) * 0.55, 24);
        const { yScale } = scale;
        const insideText = barInsideText?.[index] ?? null;
        const highlighted = interactive && hoverIndex === index;

        if (hasBand && bandMin && bandMax) {
          const minBand = bandMin[index] ?? 0;
          const maxBand = bandMax[index] ?? 0;
          const lo = yScale(minBand);
          const hi = yScale(maxBand);
          const bandTop = Math.min(lo, hi);
          return (
            <g key={`${title}-band-${label}`}>
              <rect
                x={cx - barW / 2}
                y={bandTop}
                width={barW}
                height={Math.abs(hi - lo) || 1}
                rx="2"
                fill="var(--voltflow-cyan)"
                fillOpacity={highlighted ? 0.5 : 0.35}
                stroke={highlighted ? "#ffffff" : "none"}
                strokeWidth={highlighted ? 1.5 : 0}
              />
              {maxBand > 0 ? (
                <text x={cx} y={bandTop - 3} textAnchor="middle" className="fill-muted-foreground text-[7px]">
                  {fmt(minBand, valueDigits)}–{fmt(maxBand, valueDigits)}
                </text>
              ) : null}
              <text x={cx} y="124" textAnchor="middle" className="fill-muted-foreground text-[8px]">{label}</text>
            </g>
          );
        }

        return (
          <g key={`${title}-bar-${label}`}>
            {series.map((item, seriesIndex) => {
              const offset = (seriesIndex - (series.length - 1) / 2) * (barW / Math.max(series.length, 1));
              const value = item.values[index] ?? 0;
              const baseline = yScale(scale.yMin);
              const top = yScale(value);
              const barHeight = Math.max(0, baseline - top);
              const barSliceW = barW / Math.max(series.length, 1) - 1;
              const barX = cx - barW / 2 + offset;
              const barCenterX = barX + barSliceW / 2;
              const showInside = value > scale.yMin && insideText && barHeight >= 14;
              return (
                <g key={`${item.label}-${label}`}>
                  {value > scale.yMin ? (
                    <rect
                      x={barX}
                      y={top}
                      width={barSliceW}
                      height={barHeight}
                      rx="2"
                      fill={item.color}
                      fillOpacity={highlighted ? 1 : 0.85}
                      stroke={highlighted ? "#ffffff" : "none"}
                      strokeWidth={highlighted ? 1.5 : 0}
                    />
                  ) : null}
                  {showInside ? (
                    <text
                      x={barCenterX}
                      y={top + barHeight / 2 + 3}
                      textAnchor="middle"
                      className="fill-white text-[7px] font-semibold"
                    >
                      {insideText}
                    </text>
                  ) : null}
                  {value > scale.yMin ? (
                    <text x={barCenterX} y={top - 3} textAnchor="middle" className="fill-foreground text-[7px] font-medium">
                      {fmt(value, valueDigits)}
                    </text>
                  ) : null}
                </g>
              );
            })}
            <text x={cx} y="124" textAnchor="middle" className="fill-muted-foreground text-[8px]">{label}</text>
          </g>
        );
      })}
      {interactive && hoverIndex != null ? (
        <ChartHoverCrosshair
          snapX={slotCenter(hoverIndex)}
          plotTop={STD_CHART.plotTop}
          plotBottom={STD_CHART.plotBottom}
        />
      ) : null}
      <text x="6" y="60" textAnchor="middle" transform="rotate(-90 6 60)" className="fill-muted-foreground text-[9px]">{unit}</text>
      </svg>
    );

    return (
      <InteractiveChartShell
        heightClass={heightClass}
        interactive={interactive}
        tooltip={
          interactive && hoveredLabel && tooltipRows.length > 0 ? (
            <ChartDataTooltip
              title={hoveredLabel}
              rows={tooltipRows}
              viewBoxX={slotCenter(hoverIndex ?? 0)}
              viewBoxY={STD_CHART.plotTop + 8}
              viewBoxWidth={STD_CHART.width}
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
          <p className="mt-1 text-xs text-muted-foreground">{rangeSubtitle}</p>
        </div>
        <div className="flex shrink-0 items-center">
          <IconButton label={tx("vehicle.charts.fullscreen")} onClick={() => setIsOpen(true)}>
            <Maximize2 className="size-4" aria-hidden />
          </IconButton>
        </div>
      </div>
      <div className="mt-4">{plot("h-44", compactScale, false)}</div>
      <Dialog
        open={isOpen}
        onOpenChange={(open) => {
          setIsOpen(open);
          if (!open) setHoverIndex(null);
        }}
      >
        <DialogContent className="h-[calc(100dvh-1rem)] max-w-[calc(100vw-1rem)] gap-3 p-3 sm:max-w-[calc(100vw-2rem)]">
          <DialogTitle className="sr-only">{title}</DialogTitle>
          <div className="px-1">
            <h3 className="font-heading text-xl font-semibold tracking-tight">{title}</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {referenceLine && subtitle ? subtitle : rangeSubtitle}
            </p>
          </div>
          {plot("h-[60dvh]", fullScale, Boolean(referenceLine), true)}
          <div className="px-1 pt-1">
            <ChartSeriesLegend
              series={series}
              barInsideLegend={barInsideLegend}
              referenceLine={referenceLine}
              unit={unit}
              valueDigits={valueDigits}
            />
          </div>
        </DialogContent>
      </Dialog>
    </article>
  );
}

export function PhantomDrainBarChart({
  rows,
}: {
  rows: { date: string; drainPercent: number; idleHours: number }[];
}) {
  const { t } = useTranslation();
  const tx = t as Translator;
  if (rows.length === 0) return null;

  const chart: BarChartModel = {
    title: tx("vehicle.analytics.phantomTitle"),
    unit: "%",
    valueDigits: 1,
    labels: rows.map((r) => r.date.slice(5)),
    series: [{ label: tx("vehicle.analytics.phantomDrain"), color: "#fbbf24", values: rows.map((r) => r.drainPercent) }],
  };

  return <TelemetryBarChart chart={chart} />;
}

export function TempConsumptionBarChart({ buckets }: { buckets: TempConsumptionBucket[] }) {
  const { t } = useTranslation();
  const tx = t as Translator;
  if (buckets.length < 2) return null;

  const chart: BarChartModel = {
    title: tx("vehicle.analytics.consumptionVsTemp"),
    unit: "kWh/100",
    valueDigits: 1,
    labels: buckets.map((b) => b.tempLabel),
    series: [{ label: tx("vehicle.trips.consumption"), color: "#a78bfa", values: buckets.map((b) => b.avgConsumptionKwh100) }],
  };

  return <TelemetryBarChart chart={chart} />;
}

export function useAnalyticsBarCharts(
  points: TelemetryHistoryPoint[],
  trips: { distance_km: number | null; avg_consumption_kwh_100km: number | null; started_at: string }[],
  range: TelemetryHistoryRange,
  locale: Locale,
  tx: Translator,
) {
  return useMemo(() => {
    if (range === "day") return [];
    const buckets = aggregateTelemetryBuckets(points, range, localeCode(locale));
    return buildBarCharts(buckets, trips, range, localeCode(locale), tx);
  }, [points, trips, range, locale, tx]);
}

/** Build BarChartModel[] for completed charging sessions bucketed by range. */
function buildChargingBarCharts(
  sessions: ChargingSessionRow[],
  range: TelemetryHistoryRange,
  locale: string,
  currencyUnit: string,
  tx: Translator,
): BarChartModel[] {
  const finished = sessions
    .filter((s) => (s.status === "completed" || s.status === "stopped") && s.started_at)
    .sort((a, b) => Date.parse(a.started_at!) - Date.parse(b.started_at!)); // oldest → left
  if (finished.length === 0) return [];

  const granularity = range === "quarter" || range === "year" ? "week" : "day";

  const energyByLabel = new Map<string, number>();
  const costByLabel = new Map<string, number>();
  const speedWeighted = new Map<string, { sum: number; weight: number }>();
  const countByLabel = new Map<string, number>();
  const labelsOrdered: string[] = [];
  let hasAnyPriced = false;
  let hasSpeedData = false;

  for (const session of finished) {
    const ms = Date.parse(session.started_at!);
    if (!Number.isFinite(ms)) continue;
    const d = new Date(ms);
    let key: string;
    if (granularity === "week") {
      const day = d.getUTCDay();
      const diff = day === 0 ? -6 : 1 - day;
      d.setUTCDate(d.getUTCDate() + diff);
      d.setUTCHours(0, 0, 0, 0);
      key = d.toLocaleDateString(locale, { month: "short", day: "numeric" });
    } else {
      key = d.toLocaleDateString(locale, { month: "short", day: "numeric" });
    }
    if (!labelsOrdered.includes(key)) labelsOrdered.push(key);

    const kwh = session.charged_energy_kwh ?? 0;
    energyByLabel.set(key, (energyByLabel.get(key) ?? 0) + kwh);
    countByLabel.set(key, (countByLabel.get(key) ?? 0) + 1);

    if (session.price_per_kwh > 0) {
      hasAnyPriced = true;
      costByLabel.set(key, (costByLabel.get(key) ?? 0) + (session.estimated_cost ?? 0));
    }

    if (session.charger_power_kw > 0 && kwh > 0) {
      hasSpeedData = true;
      const row = speedWeighted.get(key) ?? { sum: 0, weight: 0 };
      row.sum += session.charger_power_kw * kwh;
      row.weight += kwh;
      speedWeighted.set(key, row);
    }
  }

  if (labelsOrdered.length === 0) return [];

  const charts: BarChartModel[] = [
    {
      title: tx("vehicle.analytics.chargingEnergyTitle"),
      unit: "kWh",
      valueDigits: 1,
      labels: labelsOrdered,
      series: [{
        label: tx("vehicle.analytics.chargingEnergyLabel"),
        color: "#f59e0b",
        values: labelsOrdered.map((l) => energyByLabel.get(l) ?? 0),
      }],
      barInsideText: labelsOrdered.map((l) => {
        const n = countByLabel.get(l) ?? 0;
        return n > 0 ? `×${n}` : null;
      }),
      barInsideLegend: tx("vehicle.analytics.chargingSessionsInBar"),
    },
  ];

  if (hasAnyPriced) {
    charts.push({
      title: tx("vehicle.analytics.chargingCostChartTitle"),
      unit: currencyUnit,
      valueDigits: 2,
      labels: labelsOrdered,
      series: [{
        label: tx("vehicle.analytics.cost"),
        color: "#fb923c",
        values: labelsOrdered.map((l) => costByLabel.get(l) ?? 0),
      }],
    });
  }

  if (hasSpeedData) {
    charts.push({
      title: tx("vehicle.analytics.chargingSpeedTitle"),
      unit: "kW",
      valueDigits: 1,
      labels: labelsOrdered,
      series: [{
        label: tx("vehicle.analytics.chargingSpeedLabel"),
        color: "#a78bfa",
        values: labelsOrdered.map((l) => {
          const row = speedWeighted.get(l);
          return row && row.weight > 0 ? row.sum / row.weight : 0;
        }),
      }],
    });
  }

  return charts.filter((c) => c.series.some((s) => s.values.some((v) => v > 0)));
}

export function useChargingBarCharts(
  sessions: ChargingSessionRow[],
  range: TelemetryHistoryRange,
  locale: Locale,
  currencyUnit: string,
  tx: Translator,
): BarChartModel[] {
  return useMemo(() => {
    if (range === "day") return [];
    return buildChargingBarCharts(sessions, range, localeCode(locale), currencyUnit, tx);
  }, [sessions, range, locale, currencyUnit, tx]);
}

export type { BarChartModel };
