"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  AnalyticsSummaryStats,
  AnalyticsSummaryStatsLoading,
  PhantomDrainBarChart,
  TempConsumptionBarChart,
  useAnalyticsBarCharts,
} from "@/components/vehicle/telemetry-analytics-charts";
import { RouteInsightsSection } from "@/components/vehicle/route-insights-section";
import { TelemetryHistoryCharts, RouteMap } from "@/components/vehicle/vehicle-live-view";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useBydmateLiveQuery } from "@/hooks/use-bydmate-live-query";
import { useBydmateTelemetryHistoryQuery } from "@/hooks/use-bydmate-telemetry-history-query";
import { useTranslation } from "@/hooks/use-translation";
import { buildAnalyticsSummary, consumptionByOutsideTemp } from "@/lib/bydmate/telemetry-buckets";
import { resolveTelemetryWindow, snapAnchorDateForRange, isoWeekValueFromDate, isoWeekValueToAnchorDate, monthValueFromDate, monthValueToAnchorDate, quarterValueFromDate, quarterValueToAnchorDate, yearValueFromDate, yearValueToAnchorDate, type TelemetryHistoryRange } from "@/lib/bydmate/telemetry-ranges";
import type { RouteInsightsResult } from "@/lib/bydmate/route-insights";
import { useAppPreferences } from "@/stores/use-app-preferences";
import { devFetch, isDevAppRoute, withDevApiParams } from "@/lib/dev/dev-fetch";
import { formatCurrencyAmount, type Locale, type TranslationKey } from "@/lib/i18n";
import type { BydmateTripRow, BydmateTripTrackPointRow } from "@/types/database";

const HISTORY_RANGES: TelemetryHistoryRange[] = ["day", "week", "month", "quarter", "year"];

type Translator = (key: TranslationKey, values?: Record<string, string | number>) => string;

type PeriodTripRow = BydmateTripRow & { outside_temp_avg?: number | null };

function fmt(value: number | null | undefined, digits = 1) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "—";
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
  const weekPickerValue = useMemo(() => isoWeekValueFromDate(anchorDate), [anchorDate]);
  const monthPickerValue = useMemo(() => monthValueFromDate(anchorDate), [anchorDate]);
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
        <Input
          type="week"
          value={weekPickerValue}
          onChange={(event) => onAnchorDateChange(isoWeekValueToAnchorDate(event.target.value))}
          className="w-52"
        />
      ) : range === "month" ? (
        <Input
          type="month"
          value={monthPickerValue}
          onChange={(event) => onAnchorDateChange(monthValueToAnchorDate(event.target.value))}
          className="w-44"
        />
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

export function VehicleAnalyticsPanels({ vehicleId }: { vehicleId: string }) {
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
  const [historyRange, setHistoryRange] = useState<TelemetryHistoryRange>("week");
  const [anchorDate, setAnchorDate] = useState(() =>
    snapAnchorDateForRange("week", new Date().toISOString().slice(0, 10)),
  );
  const [monthKey, setMonthKey] = useState(() => new Date().toISOString().slice(0, 7));
  const [costFrom, setCostFrom] = useState(() =>
    new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10),
  );
  const [costTo, setCostTo] = useState(() => new Date().toISOString().slice(0, 10));

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

  const periodTripsQuery = useQuery({
    queryKey: ["vehicle-analytics", "period-trips", historyRange, anchorDate, vehicleId],
    queryFn: () =>
      fetchAnalytics<{ trips: PeriodTripRow[] }>(
        `/api/vehicle/analytics?type=period-trips&from=${encodeURIComponent(telemetryWindow.from)}&to=${encodeURIComponent(telemetryWindow.to)}&vehicle_id=${encodeURIComponent(vehicleId)}`,
      ),
  });

  const periodTrips = periodTripsQuery.data?.trips ?? [];

  const sohQuery = useBydmateTelemetryHistoryQuery({
    range: "year",
    anchorDate,
    vehicleId,
  });

  const monthlyQuery = useQuery({
    queryKey: ["vehicle-analytics", "monthly", monthKey, vehicleId],
    queryFn: () =>
      fetchAnalytics<{
        distanceKm: number;
        regenKwh: number;
        chargedKwh: number;
        chargingCost: number;
        sessionCount: number;
        tripCount: number;
        avgConsumptionKwh100: number | null;
      }>(`/api/vehicle/analytics?type=monthly&month=${monthKey}&vehicle_id=${encodeURIComponent(vehicleId)}`),
  });

  const phantomQuery = useQuery({
    queryKey: ["vehicle-analytics", "phantom", vehicleId],
    queryFn: () =>
      fetchAnalytics<{ rows: { date: string; drainPercent: number; idleHours: number }[] }>(
        `/api/vehicle/analytics?type=phantom&vehicle_id=${encodeURIComponent(vehicleId)}`,
      ),
  });

  const costQuery = useQuery({
    queryKey: ["vehicle-analytics", "cost", costFrom, costTo, vehicleId],
    queryFn: () =>
      fetchAnalytics<{ distanceKm: number; chargingCost: number; costPerKm: number | null }>(
        `/api/vehicle/analytics?type=cost-per-km&from=${costFrom}&to=${costTo}&vehicle_id=${encodeURIComponent(vehicleId)}`,
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

  const handleRangeChange = (range: TelemetryHistoryRange) => {
    setHistoryRange(range);
    setAnchorDate((current) => snapAnchorDateForRange(range, current));
  };

  const tempConsumptionBuckets = useMemo(
    () => consumptionByOutsideTemp(periodTrips),
    [periodTrips],
  );

  const sohPoints = useMemo(() => {
    return (sohQuery.data ?? [])
      .filter((point) => typeof point.telemetry.soh_percent === "number")
      .map((point) => ({
        device_time: point.device_time,
        telemetry: { soc: point.telemetry.soh_percent },
      }));
  }, [sohQuery.data]);

  const exportBase = `/api/vehicle/export?format=csv&vehicle_id=${encodeURIComponent(vehicleId)}&from=${costFrom}T00:00:00.000Z&to=${costTo}T23:59:59.999Z`;
  const exportUrl = isDevAppRoute() ? withDevApiParams(exportBase) : exportBase;

  return (
    <div className="grid gap-3">
      <section className="voltflow-card p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-heading text-2xl font-semibold tracking-tight">
              {t("vehicle.analytics.historyTitle")}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("vehicle.analytics.historySubtitle")}</p>
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
          onAnchorDateChange={setAnchorDate}
          tx={tx}
        />

        {historyQuery.isLoading || periodTripsQuery.isLoading ? (
          <AnalyticsSummaryStatsLoading />
        ) : (
          <AnalyticsSummaryStats summary={summary} />
        )}

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
      </section>

      <section className="voltflow-card p-5">
        <h2 className="font-heading text-2xl font-semibold tracking-tight">{t("vehicle.analytics.sohTitle")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("vehicle.analytics.sohSubtitle")}</p>
        <div className="mt-4">
          <TelemetryHistoryCharts
            points={sohPoints}
            isLoading={sohQuery.isLoading}
            hasError={Boolean(sohQuery.error)}
            embedded
            chartMode="soh"
          />
        </div>
      </section>

      <section className="voltflow-card p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-heading text-2xl font-semibold tracking-tight">{t("vehicle.analytics.monthlyTitle")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("vehicle.analytics.monthlySubtitle")}</p>
          </div>
          <Input type="month" value={monthKey} onChange={(event) => setMonthKey(event.target.value)} className="w-44" />
        </div>
        {monthlyQuery.isLoading ? (
          <Skeleton className="mt-4 h-24 rounded-2xl" />
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-3 min-[430px]:grid-cols-3">
            <AnalyticsStat label={t("vehicle.analytics.trips") as string} value={String(monthlyQuery.data?.tripCount ?? 0)} />
            <AnalyticsStat label={t("vehicle.trips.distance") as string} value={`${fmt(monthlyQuery.data?.distanceKm, 0)} km`} />
            <AnalyticsStat label={t("vehicle.trips.regen") as string} value={`${fmt(monthlyQuery.data?.regenKwh, 2)} kWh`} />
            <AnalyticsStat label={t("vehicle.analytics.charged") as string} value={`${fmt(monthlyQuery.data?.chargedKwh, 1)} kWh`} />
            <AnalyticsStat label={t("vehicle.analytics.cost") as string} value={formatMoney(monthlyQuery.data?.chargingCost, 2)} />
            <AnalyticsStat
              label={t("vehicle.trips.consumption") as string}
              value={`${fmt(monthlyQuery.data?.avgConsumptionKwh100, 1)} kWh/100`}
            />
          </div>
        )}
      </section>

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
        <h2 className="font-heading text-2xl font-semibold tracking-tight">{t("vehicle.analytics.costPerKmTitle")}</h2>
        <div className="mt-4 flex flex-wrap gap-3">
          <Input type="date" value={costFrom} onChange={(event) => setCostFrom(event.target.value)} className="w-40" />
          <Input type="date" value={costTo} onChange={(event) => setCostTo(event.target.value)} className="w-40" />
        </div>
        {costQuery.isLoading ? (
          <Skeleton className="mt-4 h-16 rounded-2xl" />
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-3">
            <AnalyticsStat label={t("vehicle.trips.distance") as string} value={`${fmt(costQuery.data?.distanceKm, 0)} km`} />
            <AnalyticsStat label={t("vehicle.analytics.cost") as string} value={formatMoney(costQuery.data?.chargingCost, 2)} />
            <AnalyticsStat
              label={t("vehicle.analytics.costPerKm") as string}
              value={
                typeof costQuery.data?.costPerKm === "number" && Number.isFinite(costQuery.data.costPerKm)
                  ? `${formatMoney(costQuery.data.costPerKm, 3)}/km`
                  : "—"
              }
            />
          </div>
        )}
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

function AnalyticsStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-white/[0.02] p-3">
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-1 font-heading text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}
