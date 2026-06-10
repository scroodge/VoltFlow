"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { AnalyticsDayView } from "@/components/vehicle/analytics-day-view";
import { HistoryDaySummaryCard } from "@/components/history/history-day-summary-card";
import {
  AnalyticsSummaryStats,
  AnalyticsSummaryStatsLoading,
  PhantomDrainBarChart,
  TelemetryBarChart,
  TempConsumptionBarChart,
  useAnalyticsBarCharts,
  useChargingBarCharts,
} from "@/components/vehicle/telemetry-analytics-charts";
import { RouteInsightsSection } from "@/components/vehicle/route-insights-section";
import { RouteMap, TelemetryHistoryCharts } from "@/components/vehicle/vehicle-live-view";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useBydmateLiveQuery } from "@/hooks/use-bydmate-live-query";
import { useBydmateSohHistoryQuery } from "@/hooks/use-bydmate-soh-history-query";
import { useBydmateTelemetryHistoryQuery } from "@/hooks/use-bydmate-telemetry-history-query";
import type { TelemetryHistoryPoint } from "@/lib/bydmate/telemetry-history";
import { useTranslation } from "@/hooks/use-translation";
import { buildAnalyticsSummary, consumptionByOutsideTemp } from "@/lib/bydmate/telemetry-buckets";
import { computeHistoryPeriodSummary } from "@/lib/history-day-summary";
import {
  parseAnalyticsRange,
  resolveTelemetryWindow,
  snapAnchorDateForRange,
  monthValueToAnchorDate,
  quarterValueFromDate,
  quarterValueToAnchorDate,
  yearValueFromDate,
  yearValueToAnchorDate,
  type TelemetryHistoryRange,
} from "@/lib/bydmate/telemetry-ranges";
import type { RouteInsightsResult } from "@/lib/bydmate/route-insights";
import { useAppPreferences } from "@/stores/use-app-preferences";
import { devFetch, isDevAppRoute, withDevApiParams } from "@/lib/dev/dev-fetch";
import { formatCurrencyAmount, type Locale, type TranslationKey } from "@/lib/i18n";
import type { BydmateTripRow, BydmateTripTrackPointRow, ChargingSessionRow } from "@/types/database";

const HISTORY_RANGES: TelemetryHistoryRange[] = ["day", "week", "month", "quarter", "year"];

type Translator = (key: TranslationKey, values?: Record<string, string | number>) => string;

type PeriodTripRow = BydmateTripRow & { outside_temp_avg?: number | null };

function fmt(value: number | null | undefined, digits = 1) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "—";
}

function parseInitialAnchorDate(range: TelemetryHistoryRange, dateParam: string | null) {
  if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    return snapAnchorDateForRange(range, dateParam);
  }
  return snapAnchorDateForRange(range, new Date().toISOString().slice(0, 10));
}

async function fetchAnalytics<T>(path: string): Promise<T> {
  const response = isDevAppRoute()
    ? await devFetch(path)
    : await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error("Failed to load analytics");
  return response.json() as Promise<T>;
}

const anchorSelectClassName =
  "h-8 min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30";

const MONTH_NAMES_EN = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function AnalyticsRangeAnchorPicker({
  range,
  anchorDate,
  onAnchorDateChange,
  tx,
}: {
  range: TelemetryHistoryRange;
  anchorDate: string;
  onAnchorDateChange: (value: string) => void;
  tx: Translator;
}) {
  // Week: anchorDate is already the Monday of the week (YYYY-MM-DD)
  // Month: anchorDate is YYYY-MM-01
  const monthYear = anchorDate ? Number(anchorDate.slice(0, 4)) : new Date().getUTCFullYear();
  const monthNum = anchorDate ? Number(anchorDate.slice(5, 7)) : new Date().getUTCMonth() + 1;

  const quarterPickerValue = useMemo(() => quarterValueFromDate(anchorDate), [anchorDate]);
  const yearPickerValue = useMemo(() => yearValueFromDate(anchorDate), [anchorDate]);

  const quarterMatch = /^(\d{4})-Q([1-4])$/.exec(quarterPickerValue);
  const quarterYear = quarterMatch ? Number(quarterMatch[1]) : new Date().getUTCFullYear();
  const quarterNum = quarterMatch ? Number(quarterMatch[2]) : 1;

  const labelKey =
    range === "week"
      ? "vehicle.analytics.anchorWeek"
      : range === "month"
        ? "vehicle.analytics.anchorMonth"
        : range === "quarter"
          ? "vehicle.analytics.anchorQuarter"
          : range === "year"
            ? "vehicle.analytics.anchorYear"
            : "vehicle.trips.date";

  return (
    <label className="mt-4 grid gap-1 text-sm text-muted-foreground">
      {tx(labelKey)}
      {range === "week" ? (
        // type="week" unsupported on iOS — use date input snapped to Monday
        <Input
          type="date"
          value={anchorDate}
          onChange={(event) =>
            onAnchorDateChange(snapAnchorDateForRange("week", event.target.value))
          }
          className="w-44"
        />
      ) : range === "month" ? (
        // type="month" unsupported on iOS — use select + year number like quarter
        <div className="flex flex-wrap gap-2">
          <select
            value={monthNum}
            onChange={(event) =>
              onAnchorDateChange(
                monthValueToAnchorDate(
                  `${monthYear}-${String(event.target.value).padStart(2, "0")}`,
                ),
              )
            }
            className={`${anchorSelectClassName} w-36`}
            aria-label={tx("vehicle.analytics.anchorMonth")}
          >
            {MONTH_NAMES_EN.map((name, i) => (
              <option key={i} value={i + 1}>{name}</option>
            ))}
          </select>
          <Input
            type="number"
            min={2018}
            max={2100}
            value={monthYear}
            onChange={(event) =>
              onAnchorDateChange(
                monthValueToAnchorDate(
                  `${event.target.value}-${String(monthNum).padStart(2, "0")}`,
                ),
              )
            }
            className="w-28"
            aria-label={tx("vehicle.analytics.anchorYear")}
          />
        </div>
      ) : range === "quarter" ? (
        <div className="flex flex-wrap gap-2">
          <select
            value={quarterNum}
            onChange={(event) =>
              onAnchorDateChange(
                quarterValueToAnchorDate(`${quarterYear}-Q${event.target.value}`),
              )
            }
            className={`${anchorSelectClassName} w-24`}
            aria-label={tx("vehicle.analytics.anchorQuarter")}
          >
            <option value={1}>Q1</option>
            <option value={2}>Q2</option>
            <option value={3}>Q3</option>
            <option value={4}>Q4</option>
          </select>
          <Input
            type="number"
            min={2018}
            max={2100}
            value={quarterYear}
            onChange={(event) =>
              onAnchorDateChange(
                quarterValueToAnchorDate(`${event.target.value}-Q${quarterNum}`),
              )
            }
            className="w-28"
            aria-label={tx("vehicle.analytics.anchorYear")}
          />
        </div>
      ) : range === "year" ? (
        <Input
          type="number"
          min={2018}
          max={2100}
          value={yearPickerValue}
          onChange={(event) => onAnchorDateChange(yearValueToAnchorDate(event.target.value))}
          className="w-28"
        />
      ) : (
        <Input
          type="date"
          value={anchorDate}
          onChange={(event) => onAnchorDateChange(event.target.value)}
          className="w-44"
        />
      )}
    </label>
  );
}

export function VehicleAnalyticsPanels({
  vehicleId,
  initialRange = null,
  initialDate = null,
  onAnalyticsStateChange,
}: {
  vehicleId: string;
  initialRange?: TelemetryHistoryRange | null;
  initialDate?: string | null;
  onAnalyticsStateChange?: (state: { range: TelemetryHistoryRange; date: string }) => void;
}) {
  const { locale, t } = useTranslation();
  const tx = t as Translator;
  const currency = useAppPreferences((state) => state.currency);

  const formatMoney = (value: number | null | undefined, digits = 2) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return "—";
    return formatCurrencyAmount(currency, value, locale as Locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  };

  const [historyRange, setHistoryRange] = useState<TelemetryHistoryRange>(() =>
    initialRange ? parseAnalyticsRange(initialRange) : "day",
  );
  const [anchorDate, setAnchorDate] = useState(() =>
    parseInitialAnchorDate(
      initialRange ? parseAnalyticsRange(initialRange) : "day",
      initialDate,
    ),
  );

  useEffect(() => {
    if (initialRange == null && initialDate == null) return;
    const range = parseAnalyticsRange(initialRange);
    setHistoryRange(range);
    setAnchorDate(parseInitialAnchorDate(range, initialDate));
  }, [initialRange, initialDate]);

  const notifyState = useCallback(
    (range: TelemetryHistoryRange, date: string) => {
      onAnalyticsStateChange?.({ range, date });
    },
    [onAnalyticsStateChange],
  );

  const { data: liveRows = [] } = useBydmateLiveQuery();
  const currentOutsideTemp =
    liveRows.find((row) => row.vehicle_id === vehicleId)?.telemetry.outside_temp_c ?? null;

  const historyQuery = useBydmateTelemetryHistoryQuery({
    range: historyRange,
    anchorDate,
    vehicleId,
  });

  const telemetryWindow = useMemo(
    () => resolveTelemetryWindow(historyRange, anchorDate),
    [historyRange, anchorDate],
  );

  const isDayRange = historyRange === "day";

  const periodTripsQuery = useQuery({
    queryKey: ["vehicle-analytics", "period-trips", historyRange, anchorDate, vehicleId],
    queryFn: () => {
      const params = new URLSearchParams({
        type: "period-trips",
        from: telemetryWindow.from,
        to: telemetryWindow.to,
        vehicle_id: vehicleId,
      });
      if (isDayRange) params.set("overlap", "1");
      return fetchAnalytics<{ trips: PeriodTripRow[] }>(`/api/vehicle/analytics?${params.toString()}`);
    },
  });

  const periodSessionsQuery = useQuery({
    queryKey: ["vehicle-analytics", "period-sessions", historyRange, anchorDate, vehicleId],
    queryFn: () => {
      const params = new URLSearchParams({
        type: "period-sessions",
        from: telemetryWindow.from,
        to: telemetryWindow.to,
      });
      return fetchAnalytics<{ sessions: ChargingSessionRow[] }>(
        `/api/vehicle/analytics?${params.toString()}`,
      );
    },
  });

  const baselineQuery = useQuery({
    queryKey: ["vehicle-analytics", "baseline", vehicleId],
    queryFn: () =>
      fetchAnalytics<{ medianKwh100: number | null; sampleTripCount: number }>(
        `/api/vehicle/analytics?type=baseline&vehicle_id=${encodeURIComponent(vehicleId)}&days=30`,
      ),
    enabled: isDayRange,
  });

  const periodTrips = periodTripsQuery.data?.trips ?? [];
  const periodSessions = periodSessionsQuery.data?.sessions ?? [];

  const periodSummary = useMemo(
    () =>
      computeHistoryPeriodSummary(
        periodSessions,
        periodTrips,
        telemetryWindow.from,
        telemetryWindow.to,
      ),
    [periodSessions, periodTrips, telemetryWindow.from, telemetryWindow.to],
  );

  const periodSummaryLoading = periodTripsQuery.isLoading || periodSessionsQuery.isLoading;

  const periodCostPerKm = useMemo(() => {
    if (!periodSummary.hasPricedSessions || periodSummary.distanceKm <= 0) return null;
    return periodSummary.chargingCost / periodSummary.distanceKm;
  }, [periodSummary]);

  const sohQuery = useBydmateSohHistoryQuery({
    anchorDate,
    vehicleId,
  });

  const phantomQuery = useQuery({
    queryKey: ["vehicle-analytics", "phantom", vehicleId],
    queryFn: () =>
      fetchAnalytics<{ rows: { date: string; drainPercent: number; idleHours: number }[] }>(
        `/api/vehicle/analytics?type=phantom&vehicle_id=${encodeURIComponent(vehicleId)}`,
      ),
  });

  const routeInsightsQuery = useQuery({
    queryKey: ["vehicle-analytics", "route-insights", vehicleId, currentOutsideTemp],
    queryFn: () => {
      const params = new URLSearchParams({
        type: "route-insights",
        vehicle_id: vehicleId,
      });
      if (currentOutsideTemp != null) {
        params.set("outside_temp", String(currentOutsideTemp));
      }
      return fetchAnalytics<RouteInsightsResult>(`/api/vehicle/analytics?${params.toString()}`);
    },
  });

  const mapQuery = useQuery({
    queryKey: ["vehicle-analytics", "lifetime-map", vehicleId],
    queryFn: () =>
      fetchAnalytics<{ points: BydmateTripTrackPointRow[] }>(
        `/api/vehicle/lifetime-map?vehicle_id=${encodeURIComponent(vehicleId)}`,
      ),
  });

  const historyPoints = historyQuery.data ?? [];

  const summary = useMemo(
    () =>
      buildAnalyticsSummary({
        points: historyPoints,
        trips: periodTrips,
      }),
    [historyPoints, periodTrips],
  );

  const barCharts = useAnalyticsBarCharts(
    historyPoints,
    periodTrips,
    historyRange,
    locale as Locale,
    tx,
  );

  // Currency symbol for charging cost bar chart
  const currencyUnit = formatCurrencyAmount(currency, 0, locale as Locale).replace(/[\d.,\s]/g, "").trim() || currency;

  const chargingBarCharts = useChargingBarCharts(
    periodSessions,
    historyRange,
    locale as Locale,
    currencyUnit,
    tx,
  );

  const handleRangeChange = (range: TelemetryHistoryRange) => {
    const nextDate = snapAnchorDateForRange(range, anchorDate);
    setHistoryRange(range);
    setAnchorDate(nextDate);
    notifyState(range, nextDate);
  };

  const handleAnchorDateChange = (date: string) => {
    setAnchorDate(date);
    notifyState(historyRange, date);
  };

  const tempConsumptionBuckets = useMemo(
    () => consumptionByOutsideTemp(periodTrips),
    [periodTrips],
  );

  const latestSohPercent = useMemo(() => {
    const points = (sohQuery.data ?? []).filter(
      (point) => typeof point.telemetry.soh_percent === "number",
    );
    if (points.length === 0) return null;

    const latest = points.reduce((best, point) =>
      Date.parse(point.device_time) >= Date.parse(best.device_time) ? point : best,
    );
    return latest.telemetry.soh_percent ?? null;
  }, [sohQuery.data]);

  const exportBase = `/api/vehicle/export?format=csv&vehicle_id=${encodeURIComponent(vehicleId)}&from=${telemetryWindow.from}&to=${telemetryWindow.to}`;
  const exportUrl = isDevAppRoute() ? withDevApiParams(exportBase) : exportBase;

  const historySubtitle =
    historyRange === "day"
      ? t("vehicle.analytics.daySubtitle")
      : t("vehicle.analytics.historySubtitle");

  const baseline = baselineQuery.data
    ? {
        medianKwh100: baselineQuery.data.medianKwh100,
        sampleTripCount: baselineQuery.data.sampleTripCount,
      }
    : null;

  return (
    <div className="grid gap-3">
      <section className="voltflow-card p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-heading text-2xl font-semibold tracking-tight">
              {t("vehicle.analytics.historyTitle")}
            </h2>
            {!isDayRange ? (
              <p className="mt-1 text-sm text-muted-foreground">{historySubtitle}</p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {HISTORY_RANGES.map((range) => (
              <button
                key={range}
                type="button"
                onClick={() => handleRangeChange(range)}
                className={
                  "rounded-full border px-3 py-1.5 text-sm capitalize transition " +
                  (historyRange === range
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border text-muted-foreground hover:border-primary/40")
                }
              >
                {t(`vehicle.analytics.range.${range}`)}
              </button>
            ))}
          </div>
        </div>
        <AnalyticsRangeAnchorPicker
          range={historyRange}
          anchorDate={anchorDate}
          onAnchorDateChange={handleAnchorDateChange}
          tx={tx}
        />

        <div className="mt-4">
          <HistoryDaySummaryCard
            summary={periodSummary}
            loading={periodSummaryLoading}
            locale={locale as Locale}
            currency={currency}
            scope={historyRange}
            requireCharging={false}
          />
        </div>

        {isDayRange ? (
          <AnalyticsDayView
            summary={summary}
            trips={periodTrips}
            baseline={baseline}
            historyPoints={historyPoints}
            anchorDate={anchorDate}
            isLoading={historyQuery.isLoading || periodTripsQuery.isLoading}
            hasSummaryError={Boolean(historyQuery.error || periodTripsQuery.error)}
            hasTripsError={Boolean(periodTripsQuery.error)}
            historyLoading={historyQuery.isLoading}
            historyError={Boolean(historyQuery.error)}
          />
        ) : (
          <>
            {historyQuery.isLoading || periodTripsQuery.isLoading ? (
              <AnalyticsSummaryStatsLoading />
            ) : (
              <AnalyticsSummaryStats summary={summary} chargedKwh={periodSummary.chargedKwh > 0 ? periodSummary.chargedKwh : null} />
            )}
            {!periodSummaryLoading && periodSummary.hasPricedSessions ? (
              <div className="mt-3 grid grid-cols-2 gap-3 min-[430px]:grid-cols-3">
                <AnalyticsStat label={t("vehicle.analytics.cost") as string} value={formatMoney(periodSummary.chargingCost)} />
                {periodCostPerKm != null ? (
                  <AnalyticsStat label={t("vehicle.analytics.costPerKm") as string} value={`${formatMoney(periodCostPerKm, 3)}/km`} />
                ) : null}
              </div>
            ) : null}

            <div className="mt-4">
              <TelemetryHistoryCharts
                points={historyPoints}
                isLoading={historyQuery.isLoading}
                hasError={Boolean(historyQuery.error)}
                embedded
                chartMode="analytics"
                historyRange={historyRange}
                anchorDate={anchorDate}
                barCharts={barCharts}
              />
            </div>
          </>
        )}
      </section>

      <section className="voltflow-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-heading text-2xl font-semibold tracking-tight">
              {t("vehicle.analytics.sohTitle")}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("vehicle.analytics.sohSubtitle")}</p>
          </div>
          {latestSohPercent != null ? (
            <p className="font-heading text-4xl font-bold tabular-nums tracking-tight text-[var(--voltflow-cyan)]">
              {fmt(latestSohPercent, 1)}
              <span className="ml-0.5 text-xl font-semibold text-muted-foreground">%</span>
            </p>
          ) : null}
        </div>
        <div className="mt-4">
          {sohQuery.isLoading ? (
            <Skeleton className="h-40 rounded-2xl" />
          ) : sohQuery.error || (sohQuery.data ?? []).length === 0 ? (
            <p className="rounded-2xl border border-border bg-white/[0.03] p-4 text-sm text-muted-foreground">
              {t("vehicle.analytics.sohNoData")}
            </p>
          ) : (
            <SohTrendChart points={sohQuery.data ?? []} locale={locale} />
          )}
        </div>
      </section>

      {!isDayRange && chargingBarCharts.length > 0 ? (
        <section className="voltflow-card p-5">
          <h2 className="font-heading text-2xl font-semibold tracking-tight">
            {t("vehicle.analytics.chargingTrendsTitle")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("vehicle.analytics.chargingTrendsSubtitle")}
          </p>
          {periodSessionsQuery.isLoading ? (
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              <Skeleton className="h-52 rounded-2xl" />
              <Skeleton className="h-52 rounded-2xl" />
            </div>
          ) : (
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {chargingBarCharts.map((chart) => (
                <TelemetryBarChart key={chart.title} chart={chart} />
              ))}
            </div>
          )}
        </section>
      ) : null}

      <section className="voltflow-card p-5">
        <h2 className="font-heading text-2xl font-semibold tracking-tight">{t("vehicle.analytics.phantomTitle")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("vehicle.analytics.phantomSubtitle")}</p>
        {phantomQuery.isLoading ? (
          <Skeleton className="mt-4 h-52 rounded-2xl" />
        ) : (phantomQuery.data?.rows.length ?? 0) === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">{t("vehicle.analytics.phantomEmpty")}</p>
        ) : (
          <div className="mt-4">
            <PhantomDrainBarChart rows={phantomQuery.data?.rows ?? []} />
          </div>
        )}
      </section>

      {tempConsumptionBuckets.length >= 2 ? (
        <section className="voltflow-card p-5">
          <h2 className="font-heading text-2xl font-semibold tracking-tight">
            {t("vehicle.analytics.consumptionVsTemp")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("vehicle.analytics.consumptionVsTempSubtitle")}</p>
          <div className="mt-4">
            <TempConsumptionBarChart buckets={tempConsumptionBuckets} />
          </div>
        </section>
      ) : null}

      <section className="voltflow-card p-5">
        <h2 className="font-heading text-2xl font-semibold tracking-tight">{t("vehicle.analytics.routeInsightsTitle")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("vehicle.analytics.routeInsightsSubtitle")}</p>
        <RouteInsightsSection
          routes={routeInsightsQuery.data?.routes ?? []}
          parkedRoutes={routeInsightsQuery.data?.parkedRoutes ?? []}
          isLoading={routeInsightsQuery.isLoading}
          vehicleId={vehicleId}
        />
      </section>

      <section className="voltflow-card p-5">
        <h2 className="font-heading text-2xl font-semibold tracking-tight">{t("vehicle.analytics.lifetimeMapTitle")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("vehicle.analytics.lifetimeMapSubtitle")}</p>
        <div className="mt-4">
          <RouteMap
            trackPoints={mapQuery.data?.points ?? []}
            isLoading={mapQuery.isLoading}
            hasError={Boolean(mapQuery.error)}
            embedded
          />
        </div>
      </section>

      <section className="voltflow-card p-5">
        <h2 className="font-heading text-2xl font-semibold tracking-tight">{t("vehicle.analytics.exportTitle")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("vehicle.analytics.exportSubtitle")}</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button asChild variant="outline">
            <a href={exportUrl} download>{t("vehicle.analytics.exportCsv")}</a>
          </Button>
          <Button asChild variant="outline">
            <a
              href={exportUrl.replace("format=csv", "format=json")}
              download
            >
              {t("vehicle.analytics.exportJson")}
            </a>
          </Button>
        </div>
      </section>
    </div>
  );
}

function SohTrendChart({
  points,
  locale,
}: {
  points: TelemetryHistoryPoint[];
  locale: string;
}) {
  const validPoints = points
    .filter((p) => typeof p.telemetry.soh_percent === "number" && Number.isFinite(p.telemetry.soh_percent))
    .map((p) => ({ time: Date.parse(p.device_time), soh: p.telemetry.soh_percent as number }))
    .sort((a, b) => a.time - b.time);

  if (validPoints.length < 2) {
    if (validPoints.length === 1) {
      return (
        <p className="font-heading text-4xl font-bold tabular-nums tracking-tight text-[var(--voltflow-cyan)]">
          {validPoints[0].soh.toFixed(1)}
          <span className="ml-0.5 text-xl font-semibold text-muted-foreground">%</span>
        </p>
      );
    }
    return null;
  }

  const minTime = validPoints[0].time;
  const maxTime = validPoints[validPoints.length - 1].time;
  const minSoh = Math.min(...validPoints.map((p) => p.soh));
  const maxSoh = Math.max(...validPoints.map((p) => p.soh));
  const sohPad = Math.max((maxSoh - minSoh) * 0.2, 0.5);
  const yMin = Math.max(0, minSoh - sohPad);
  const yMax = Math.min(105, maxSoh + sohPad);

  const xFn = (time: number) => {
    if (maxTime === minTime) return 176;
    return 34 + ((time - minTime) / (maxTime - minTime)) * 284;
  };
  const yFn = (soh: number) => {
    if (yMax === yMin) return 60;
    return 104 - ((soh - yMin) / (yMax - yMin)) * 88;
  };

  const pathD = validPoints
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xFn(p.time).toFixed(1)} ${yFn(p.soh).toFixed(1)}`)
    .join(" ");

  const latest = validPoints[validPoints.length - 1];
  const dateFmt = (ms: number) =>
    new Date(ms).toLocaleDateString(locale, { month: "short", day: "numeric" });
  const midTime = (minTime + maxTime) / 2;

  const yTicks = [
    { v: yMax, label: `${yMax.toFixed(1)}%` },
    { v: (yMin + yMax) / 2, label: `${((yMin + yMax) / 2).toFixed(1)}%` },
    { v: yMin, label: `${yMin.toFixed(1)}%` },
  ];

  return (
    <svg className="h-44 w-full overflow-visible" viewBox="0 0 340 140">
      <line x1="34" x2="318" y1="104" y2="104" stroke="currentColor" className="text-border" strokeWidth="1" />
      <line x1="34" x2="34" y1="16" y2="104" stroke="currentColor" className="text-border" strokeWidth="1" />
      {yTicks.map((tick) => (
        <g key={tick.label}>
          <line x1="34" x2="318" y1={yFn(tick.v)} y2={yFn(tick.v)} stroke="currentColor" className="text-border/40" strokeWidth="1" strokeDasharray="4 6" />
          <text x="29" y={yFn(tick.v) + 3} textAnchor="end" fontSize="9" className="fill-muted-foreground">
            {tick.label}
          </text>
        </g>
      ))}
      {[minTime, midTime, maxTime].map((t, i) => (
        <g key={i}>
          <line x1={xFn(t)} x2={xFn(t)} y1="104" y2="109" stroke="currentColor" className="text-border" strokeWidth="1" />
          <text x={xFn(t)} y="122" textAnchor="middle" fontSize="9" className="fill-muted-foreground">
            {dateFmt(t)}
          </text>
        </g>
      ))}
      <path d={pathD} fill="none" stroke="var(--voltflow-cyan)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {validPoints.length <= 60
        ? validPoints.map((p, i) => (
            <circle key={i} cx={xFn(p.time)} cy={yFn(p.soh)} r="2.5" fill="var(--voltflow-cyan)" />
          ))
        : null}
      <circle cx={xFn(latest.time)} cy={yFn(latest.soh)} r="5" fill="var(--voltflow-cyan)" stroke="#fff" strokeWidth="1.5" />
    </svg>
  );
}

function AnalyticsStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-white/[0.02] p-3">
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-1 font-heading text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}
