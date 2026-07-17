"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { TripDetailPanel } from "@/components/vehicle/TripDetailPanel";
import {
  AnalyticsSummaryStats,
  AnalyticsSummaryStatsLoading,
} from "@/components/vehicle/telemetry-analytics-charts";
import { TelemetryHistoryCharts } from "@/components/vehicle/vehicle-live-view";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "@/hooks/use-translation";
import {
  buildDayInsights,
  totalMeasuredTripEnergyKwh,
  weightedAvgConsumptionKwh100,
  type ConsumptionBaseline,
  type DayInsight,
  type TripWithEnergy,
} from "@/lib/bydmate/day-insights";
import type { AnalyticsSummary } from "@/lib/bydmate/telemetry-buckets";
import type { TelemetryHistoryPoint } from "@/lib/bydmate/telemetry-history";
import type { TranslationKey } from "@/lib/i18n";

type Translator = (key: TranslationKey, values?: Record<string, string | number>) => string;

function fmt(value: number | null | undefined, digits = 1) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "—";
}

function formatClock(isoStr: string) {
  const d = new Date(isoStr);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function tripDuration(trip: TripWithEnergy) {
  const startMs = Date.parse(trip.started_at);
  const endMs = Date.parse(trip.ended_at ?? trip.last_device_time);
  const seconds = Math.max(0, (endMs - startMs) / 1000);
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function insightMessage(insight: DayInsight, tx: Translator): string {
  switch (insight.kind) {
    case "baseline":
      return insight.better
        ? tx("vehicle.analytics.dayInsight.baselineBetter", {
            day: fmt(insight.dayKwh100, 1),
            baseline: fmt(insight.baselineKwh100, 1),
            percent: Math.abs(Math.round(insight.deltaPercent)),
          })
        : tx("vehicle.analytics.dayInsight.baselineWorse", {
            day: fmt(insight.dayKwh100, 1),
            baseline: fmt(insight.baselineKwh100, 1),
            percent: Math.abs(Math.round(insight.deltaPercent)),
          });
    case "trip_efficiency":
      return insight.variant === "best"
        ? tx("vehicle.analytics.dayInsight.tripBest", {
            time: insight.startedAt,
            value: fmt(insight.kwh100, 1),
            km: fmt(insight.distanceKm, 0),
          })
        : tx("vehicle.analytics.dayInsight.tripWorst", {
            time: insight.startedAt,
            value: fmt(insight.kwh100, 1),
            km: fmt(insight.distanceKm, 0),
          });
    case "regen_share":
      return tx("vehicle.analytics.dayInsight.regenShare", {
        regen: fmt(insight.regenKwh, 2),
        percent: fmt(insight.sharePercent, 0),
      });
    case "regen_compare":
      return tx("vehicle.analytics.dayInsight.regenCompare", {
        high: fmt(insight.highRegenKwh100, 1),
        low: fmt(insight.lowRegenKwh100, 1),
        highCount: insight.highTripCount,
        lowCount: insight.lowTripCount,
      });
    case "regen_insufficient":
      return tx("vehicle.analytics.dayInsight.regenInsufficient");
    default:
      return "";
  }
}

function DayInsightCards({ insights, tx }: { insights: DayInsight[]; tx: Translator }) {
  if (insights.length === 0) return null;

  return (
    <div className="mt-4 grid gap-2">
      {insights.map((insight, index) => (
        <div
          key={`${insight.kind}-${index}`}
          className="rounded-2xl border border-border bg-white/[0.02] px-4 py-3 text-sm leading-relaxed text-foreground"
        >
          {insightMessage(insight, tx)}
        </div>
      ))}
    </div>
  );
}

function AnalyticsDayTripRow({
  trip,
  baselineKwh100,
  expanded,
  showDetail,
  onToggle,
  onToggleDetail,
  tx,
}: {
  trip: TripWithEnergy;
  baselineKwh100: number | null;
  expanded: boolean;
  showDetail: boolean;
  onToggle: () => void;
  onToggleDetail: () => void;
  tx: Translator;
}) {
  const consumption = trip.avg_consumption_kwh_100km;
  const tripEnergy = Number.isFinite(trip.traction_energy_kwh) ? trip.traction_energy_kwh : null;
  let normBadge: string | null = null;
  if (baselineKwh100 != null && consumption != null && consumption > 0) {
    const delta = ((consumption - baselineKwh100) / baselineKwh100) * 100;
    if (delta <= -5) normBadge = tx("vehicle.analytics.dayTrip.belowNorm");
    else if (delta >= 5) normBadge = tx("vehicle.analytics.dayTrip.aboveNorm");
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-hidden rounded-2xl border border-border bg-white/[0.02]">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition hover:bg-white/[0.03]"
        >
          {expanded ? (
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          ) : (
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          )}
          <div className="min-w-0 flex-1">
            <p className="font-heading text-sm font-semibold">
              {formatClock(trip.started_at)}
              <span className="ml-1.5 font-normal text-muted-foreground">{tripDuration(trip)}</span>
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {fmt(trip.distance_km, 1)} km
              {trip.regen_energy_kwh != null
                ? ` · ${fmt(trip.regen_energy_kwh, 2)} kWh regen`
                : ""}
            </p>
          </div>
          {normBadge ? (
            <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              {normBadge}
            </span>
          ) : null}
          <div className="shrink-0 text-right tabular-nums" aria-label={tx("vehicle.trips.traction")}>
            <p className="font-heading text-sm font-semibold text-emerald-300">
              {tripEnergy != null ? (
                <>
                  {fmt(tripEnergy, 2)}
                  <span className="text-xs font-normal text-muted-foreground"> kWh</span>
                </>
              ) : (
                "—"
              )}
            </p>
            <p className="mt-0.5 text-[11px] font-medium text-muted-foreground">
              {fmt(consumption, 1)} kWh/100
            </p>
          </div>
        </button>

        {expanded ? (
          <div className="border-t border-border px-3 pb-3 pt-2.5">
            <Button
              variant="outline"
              size="sm"
              onClick={onToggleDetail}
              className="h-8 w-full rounded-full border-border font-heading text-xs font-semibold"
            >
              {showDetail ? tx("vehicle.analytics.dayTrip.hideDetail") : tx("vehicle.analytics.dayTrip.viewDetail")}
            </Button>
          </div>
        ) : null}
      </div>
      {expanded && showDetail ? <TripDetailPanel tripId={trip.id} /> : null}
    </div>
  );
}

export function AnalyticsDayView({
  summary,
  trips,
  baseline,
  historyPoints,
  anchorDate,
  isLoading,
  hasSummaryError,
  hasTripsError,
  historyLoading,
  historyError,
}: {
  summary: AnalyticsSummary;
  trips: TripWithEnergy[];
  baseline: ConsumptionBaseline | null;
  historyPoints: TelemetryHistoryPoint[];
  anchorDate: string;
  isLoading: boolean;
  hasSummaryError: boolean;
  hasTripsError: boolean;
  historyLoading: boolean;
  historyError: boolean;
}) {
  const { t } = useTranslation();
  const tx = t as Translator;
  const [showFullDayCharts, setShowFullDayCharts] = useState(false);
  const [expandedTripId, setExpandedTripId] = useState<string | null>(null);
  const [detailTripId, setDetailTripId] = useState<string | null>(null);

  const insights = useMemo(
    () => buildDayInsights({ trips, baseline }),
    [trips, baseline],
  );

  const sortedTrips = useMemo(() => {
    return [...trips].sort(
      (a, b) => (b.avg_consumption_kwh_100km ?? 0) - (a.avg_consumption_kwh_100km ?? 0),
    );
  }, [trips]);

  const dayKwh100 = useMemo(() => weightedAvgConsumptionKwh100(trips), [trips]);
  const dayTripEnergyKwh = useMemo(() => totalMeasuredTripEnergyKwh(trips), [trips]);

  return (
    <>
      <p className="mt-1 text-sm text-muted-foreground">{tx("vehicle.analytics.daySubtitle")}</p>

      {isLoading ? (
        <AnalyticsSummaryStatsLoading />
      ) : hasSummaryError ? (
        <p className="mt-4 text-sm text-muted-foreground">{tx("vehicle.errors.history")}</p>
      ) : (
        <AnalyticsSummaryStats summary={summary} tripEnergyKwh={dayTripEnergyKwh} />
      )}

      {!isLoading && !hasSummaryError ? <DayInsightCards insights={insights} tx={tx} /> : null}

      <div className="mt-5">
        <h3 className="font-heading text-lg font-semibold tracking-tight">
          {tx("vehicle.analytics.dayTripsTitle")}
        </h3>
        {dayKwh100 != null ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {tx("vehicle.analytics.dayTripsSubtitle", { value: fmt(dayKwh100, 1) })}
          </p>
        ) : null}

        {isLoading ? (
          <div className="mt-3 flex flex-col gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-14 rounded-2xl" />
            ))}
          </div>
        ) : hasTripsError ? (
          <p className="mt-3 text-sm text-muted-foreground">{tx("vehicle.errors.history")}</p>
        ) : sortedTrips.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-border bg-white/[0.02] p-4 text-center text-sm text-muted-foreground">
            {tx("vehicle.analytics.dayTripsEmpty")}
          </p>
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            {sortedTrips.map((trip) => (
              <AnalyticsDayTripRow
                key={trip.id}
                trip={trip}
                baselineKwh100={baseline?.medianKwh100 ?? null}
                expanded={expandedTripId === trip.id}
                showDetail={detailTripId === trip.id}
                onToggle={() => {
                  setExpandedTripId((current) => (current === trip.id ? null : trip.id));
                  if (expandedTripId === trip.id) setDetailTripId(null);
                }}
                onToggleDetail={() =>
                  setDetailTripId((current) => (current === trip.id ? null : trip.id))
                }
                tx={tx}
              />
            ))}
          </div>
        )}
      </div>

      <div className="mt-5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setShowFullDayCharts((value) => !value)}
          className="w-full rounded-full border-border font-heading text-xs font-semibold"
        >
          {showFullDayCharts
            ? tx("vehicle.analytics.dayHideFullTimeline")
            : tx("vehicle.analytics.dayShowFullTimeline")}
        </Button>
        {showFullDayCharts ? (
          <div className="mt-3">
            <TelemetryHistoryCharts
              points={historyPoints}
              isLoading={historyLoading}
              hasError={historyError}
              embedded
              chartMode="analytics"
              historyRange="day"
              anchorDate={anchorDate}
            />
          </div>
        ) : null}
      </div>
    </>
  );
}
