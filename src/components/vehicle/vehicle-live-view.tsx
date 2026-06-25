"use client";

import { useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Activity,
  BatteryCharging,
  CarFront,
  ChevronDown,
  ChevronRight,
  Clock3,
  Gauge,
  HeartPulse,
  Maximize2,
  Minimize2,
  Minus,
  MapPin,
  Navigation,
  Plus,
  Route,
  Thermometer,
  Zap,
} from "lucide-react";

import { BrandBadge } from "@/components/brand/BrandBadge";
import { LogoFull } from "@/components/brand/LogoFull";
import { useVehicleDevSnapshotOverride } from "@/components/dev/vehicle-dev-snapshot-context";
import { VehicleAnalyticsTeaser } from "@/components/vehicle/vehicle-analytics-teaser";
import { VehicleControlPanel } from "@/components/vehicle/vehicle-control-panel";
import { ChartSeriesLegend, TelemetryBarChart, type BarChartModel } from "@/components/vehicle/telemetry-analytics-charts";
import {
  ChartDataTooltip,
  CHART_LINE_GAP_MS,
  ChartHoverCrosshair,
  InteractiveChartShell,
  STD_CHART,
  DELTA_SOC_CHART,
  buildBrokenLinePaths,
  chartLineGapMs,
  clientToSvg,
  nearestIndexByX,
  nearestPointByTime,
} from "@/components/vehicle/chart-interaction";
import { formatHistoryRangeSubtitle } from "@/lib/bydmate/telemetry-buckets";
import type { TelemetryHistoryRange } from "@/lib/bydmate/telemetry-ranges";
import { MAX_TELEMETRY_CHART_POINTS, medianSampleGapSeconds } from "@/lib/bydmate/telemetry-ranges";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useBydmateLiveQuery } from "@/hooks/use-bydmate-live-query";
import { useVehicleRangeEstimate } from "@/hooks/use-vehicle-range-estimate";
import { useBydmateTripSamplesQuery } from "@/hooks/use-bydmate-trip-samples-query";
import { useBydmateTripTrackQuery } from "@/hooks/use-bydmate-trip-track-query";
import { useBydmateTripsQuery, useLatestBydmateTripsQuery } from "@/hooks/use-bydmate-trips-query";
import { useCarsQuery } from "@/hooks/use-cars-query";
import { useSessionsQuery } from "@/hooks/use-sessions-query";
import { useTickingClock } from "@/hooks/use-ticking-clock";
import { useTranslation } from "@/hooks/use-translation";
import { useAppPath } from "@/lib/dev/dev-path";
import { gearIsPark, readGear } from "@/lib/bydmate/gear";
import { isTelemetryCharging } from "@/lib/bydmate/telemetry-charging";
import { averageTripConsumption } from "@/lib/bydmate/range-estimate";
import {
  computeHeroDriveMetrics,
  formatHeroDistanceKm,
  formatKmPerPercent,
} from "@/lib/bydmate/hero-drive-metrics";
import { calculateRegenRecoverySegments, calculateTripEnergy, prepareRegenRecoveryBars } from "@/lib/bydmate/trip-energy";
import { isRouteTrackDisplayable } from "@/lib/bydmate/route-insights";
import {
  odometerDeltaFromSamples,
  resolvePreferredTripDistanceKm,
  trackPathDistanceKm,
} from "@/lib/bydmate/trip-distance";
import { formatCurrencyAmount } from "@/lib/i18n";
import type { Currency, Locale, TranslationKey } from "@/lib/i18n";
import {
  deriveDashboardVehicleMode,
  resolveLiveSnapshotForVehicle,
  type DashboardVehicleMode,
  vehicleStatusLabelKey,
} from "@/lib/vehicle-live-mode";
import { useAppPreferences } from "@/stores/use-app-preferences";
import type {
  BydmateLiveSnapshotRow,
  BydmateDiplus,
  BydmateLocation,
  BydmateTelemetry,
  BydmateTelemetryPointRow,
  BydmateTripRow,
  BydmateTripTrackPointRow,
} from "@/types/database";

function fmt(value: number | null | undefined, digits = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "—";
}

function fmtTemp(value: number | null | undefined, digits = 1) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < -50 || value > 90) {
    return "—";
  }
  return `${value.toFixed(digits)} °C`;
}

function isMissingMetricValue(value: string) {
  return value === "—" || value.includes("—%") || /^—\s/.test(value);
}

function finiteMetric(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function finiteKm(value: unknown) {
  return finiteMetric(value);
}

function readAuxVoltageV(
  snapshot: Pick<BydmateLiveSnapshotRow, "telemetry" | "diplus" | "diplus_voltage_12v">,
) {
  const fromTelemetry = finiteMetric(snapshot.telemetry.aux_voltage_v);
  if (fromTelemetry != null) return fromTelemetry;

  const fromColumn = finiteMetric(snapshot.diplus_voltage_12v);
  if (fromColumn != null) return fromColumn;

  const fromDiplus = finiteMetric(snapshot.diplus?.voltage_12v);
  if (fromDiplus != null) return fromDiplus;

  return null;
}

function heroCoreMetrics(snapshot: BydmateLiveSnapshotRow, t: Translator, locale: Locale) {
  return [
    {
      key: "auxBattery",
      icon: Zap,
      label: t("vehicle.telemetry.auxBattery"),
      value: `${fmt(readAuxVoltageV(snapshot), 1)} V`,
    },
    {
      key: "odometer",
      icon: CarFront,
      label: t("vehicle.telemetry.odometer"),
      value: fmtOdometerKm(readOdometerKm(snapshot), locale),
    },
  ];
}

function readOdometerKm(
  snapshot: Pick<BydmateLiveSnapshotRow, "telemetry" | "diplus" | "diplus_mileage_km">,
) {
  const fromTelemetry = finiteKm(snapshot.telemetry.odometer_km);
  if (fromTelemetry != null) return fromTelemetry;

  const fromColumn = finiteKm(snapshot.diplus_mileage_km);
  if (fromColumn != null) return fromColumn;

  const fromDiplus = finiteKm(snapshot.diplus?.mileage_km);
  if (fromDiplus != null) return fromDiplus;

  return null;
}

function fmtOdometerKm(km: number | null | undefined, locale: Locale) {
  if (typeof km !== "number" || !Number.isFinite(km)) return "—";
  return `${km.toLocaleString(localeCode(locale), { maximumFractionDigits: 0 })} km`;
}

function telemetryGridClass(count: number) {
  if (count % 3 === 0) return "grid grid-cols-3 gap-2";
  return "grid grid-cols-2 gap-2 min-[380px]:grid-cols-3";
}

type Translator = (key: TranslationKey, values?: Record<string, string | number>) => string;

function localeCode(locale: Locale) {
  return locale === "be" ? "be-BY" : locale === "ru" ? "ru-RU" : "en-US";
}

function timeAgo(iso: string, nowMs: number, t: Translator) {
  const seconds = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 1000));
  if (seconds < 60) return t("vehicle.timeAgoSeconds", { value: seconds });
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t("vehicle.timeAgoMinutes", { value: minutes });
  const hours = Math.round(minutes / 60);
  return t("vehicle.timeAgoHours", { value: hours });
}

function useClientMounted() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

export function VehicleLiveView({ isAdmin = false }: { isAdmin?: boolean }) {
  const { t } = useTranslation();
  const tx = t as Translator;
  const searchParams = useSearchParams();
  const initialTripId = searchParams.get("trip");
  const { data, isLoading, error } = useBydmateLiveQuery();
  const { data: carsResult } = useCarsQuery();
  const selectedCarId = useAppPreferences((state) => state.selectedCarId);
  const nowMs = useTickingClock(true);
  const scopedVehicleId = useMemo(() => {
    const cars = carsResult?.cars;
    const selectedCar =
      cars?.find((car) => car.id === selectedCarId) ?? cars?.[0] ?? null;
    return selectedCar?.vehicle_alias ?? null;
  }, [carsResult?.cars, selectedCarId]);
  const baseSnapshot = useMemo(
    () => resolveLiveSnapshotForVehicle(data ?? [], scopedVehicleId),
    [data, scopedVehicleId],
  );
  const snapshot = useVehicleDevSnapshotOverride(baseSnapshot);
  const hasMounted = useClientMounted();

  if (isLoading) {
    return (
      <div className="safe-bottom flex flex-col gap-3 px-4 pb-6 pt-4">
        <Header />
        <Skeleton className="h-32 rounded-[1.75rem]" />
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-28 rounded-[1.5rem]" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="safe-bottom flex flex-col gap-3 px-4 pb-6 pt-4">
        <Header />
        <Card className="voltflow-card border-border bg-transparent">
          <CardContent className="p-6 text-muted-foreground">
            {tx("vehicle.errors.live")}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!snapshot) {
    return <EmptyVehicleState />;
  }

  return (
    <VehicleLiveContent
      snapshot={snapshot}
      rangeBaseSnapshot={baseSnapshot}
      scopedVehicleId={scopedVehicleId}
      nowMs={nowMs}
      initialTripId={initialTripId}
      hasMounted={hasMounted}
      isAdmin={isAdmin}
    />
  );
}

export function VehicleLiveFixtureView({
  snapshot,
  points,
}: {
  snapshot: BydmateLiveSnapshotRow;
  points: BydmateTelemetryPointRow[];
}) {
  const nowMs = useTickingClock(true);

  return (
    <VehicleLiveContent
      snapshot={snapshot}
      rangeBaseSnapshot={snapshot}
      scopedVehicleId={snapshot.vehicle_id}
      nowMs={nowMs}
      fixturePoints={points}
      hasMounted
    />
  );
}

function VehicleLiveContent({
  snapshot,
  rangeBaseSnapshot,
  scopedVehicleId,
  nowMs,
  fixturePoints,
  initialTripId = null,
  hasMounted = true,
  isAdmin = false,
}: {
  snapshot: BydmateLiveSnapshotRow;
  rangeBaseSnapshot: BydmateLiveSnapshotRow | null;
  scopedVehicleId: string | null;
  nowMs: number;
  fixturePoints?: BydmateTelemetryPointRow[];
  initialTripId?: string | null;
  hasMounted?: boolean;
  isAdmin?: boolean;
}) {
  const { data: carsData } = useCarsQuery();
  const selectedCarId = useAppPreferences((state) => state.selectedCarId);
  const matchedCar = useMemo(() => {
    const cars = carsData?.cars;
    if (!cars?.length) return null;
    const selected = cars.find((car) => car.id === selectedCarId) ?? cars[0] ?? null;
    if (selected?.vehicle_alias === snapshot.vehicle_id) return selected;
    return cars.find((car) => car.vehicle_alias === snapshot.vehicle_id) ?? selected;
  }, [carsData?.cars, selectedCarId, snapshot.vehicle_id]);
  const vehicleLabel = matchedCar?.name ?? snapshot.vehicle_id;
  const batteryCapacityKwh = matchedCar?.battery_capacity_kwh ?? null;
  const vehicleMode = deriveDashboardVehicleMode({
    snapshot,
    nowMs,
    hasActiveSession: false,
  });
  const isCharging =
    vehicleMode === "live_charging" || vehicleMode === "app_charging";
  const isStale = vehicleMode === "stale";
  const [fallbackDate] = useState(() => localDateKey(Date.now()));
  const [selectedDateOverride, setSelectedDateOverride] = useState<string | null>(null);
  const fixtureDateKeys = useMemo(() => {
    if (!fixturePoints?.length) return [];
    return Array.from(new Set(fixturePoints.map((point) => localDateKey(pointTimeMs(point)))))
      .filter((key) => key !== "1970-01-01")
      .sort()
      .reverse();
  }, [fixturePoints]);
  const selectedDate = selectedDateOverride ?? fixtureDateKeys[0] ?? fallbackDate;
  const fixtureTripSegments = useMemo(() => {
    if (!fixturePoints) return null;
    const dayPoints = fixturePoints.filter(
      (point) => localDateKey(pointTimeMs(point)) === selectedDate,
    );
    return buildTrips(dayPoints);
  }, [fixturePoints, selectedDate]);
  const fixtureTrips = useMemo(
    () => fixtureTripSegments?.map((trip) => tripRowFromFixture(trip, snapshot.vehicle_id)) ?? null,
    [fixtureTripSegments, snapshot.vehicle_id],
  );
  const {
    data: apiTrips = [],
    isLoading: isTripsLoading,
    error: tripsError,
  } = useBydmateTripsQuery(selectedDate, snapshot.vehicle_id, !fixturePoints && !isCharging && !isStale);
  const { data: sessions = [] } = useSessionsQuery();
  const { data: recentTrips = [] } = useLatestBydmateTripsQuery(
    snapshot.vehicle_id,
    50,
    !fixturePoints && !isCharging && Boolean(snapshot.vehicle_id),
    true,
  );
  const trips = fixtureTrips ?? apiTrips;
  const heroDriveMetrics = useMemo(
    () =>
      computeHeroDriveMetrics({
        sessions,
        carId: matchedCar?.id ?? null,
        trips: fixtureTrips ?? recentTrips,
        snapshot,
        batteryCapacityKwh,
      }),
    [sessions, matchedCar?.id, fixtureTrips, recentTrips, snapshot, batteryCapacityKwh],
  );
  const rangeEstimate = useVehicleRangeEstimate({
    baseSnapshot: rangeBaseSnapshot,
    scopedVehicleId,
    batteryCapacityKwh,
    recentTripsOverride: fixtureTrips ?? undefined,
    enabled: !fixturePoints,
  });
  const rangeLabel =
    rangeEstimate.estimatedRangeKm != null
      ? `≈ ${fmt(rangeEstimate.estimatedRangeKm, 0)} km`
      : "—";
  const soc = snapshot.telemetry.soc;
  const mathRangeKm: number | null =
    typeof soc === "number" && heroDriveMetrics.kmPerPercentSoc != null
      ? heroDriveMetrics.kmPerPercentSoc * soc
      : null;
  const mathRangeLabel = mathRangeKm != null ? `≈ ${fmt(mathRangeKm, 0)} km` : "—";
  const [selectedTripId, setSelectedTripId] = useState<string | null | undefined>(
    initialTripId ?? undefined,
  );
  const defaultTripId = trips[0]?.id ?? null;
  const expandedTripId = selectedTripId === undefined ? defaultTripId : selectedTripId;
  const expandedFixtureTrip =
    fixtureTripSegments?.find((trip) => trip.id === expandedTripId) ?? null;

  return (
    <div className="safe-bottom flex flex-col gap-3 px-4 pb-6 pt-4">
      <Header />
      <Hero
        snapshot={snapshot}
        nowMs={nowMs}
        vehicleMode={vehicleMode}
        isStale={isStale}
        isCharging={isCharging}
        rangeLabel={rangeLabel}
        mathRangeLabel={mathRangeLabel}
        vehicleLabel={vehicleLabel}
        hasMounted={hasMounted}
        distanceSinceChargeKm={heroDriveMetrics.distanceSinceChargeKm}
        kmPerPercentSoc={heroDriveMetrics.kmPerPercentSoc}
      />
      {!fixturePoints && isAdmin ? (
        <VehicleControlPanel
          vehicleId={scopedVehicleId ?? snapshot.vehicle_id}
          collapsible
        />
      ) : null}
      {isCharging ? (
        <ChargingModeCard snapshot={snapshot} />
      ) : (
        <>
          <CellHealthCard snapshot={snapshot} />
          {isStale ? (
            <>
              <StaleTelemetryNotice />
              <LastTripCard vehicleId={snapshot.vehicle_id} hasMounted={hasMounted} />
              {!fixturePoints ? <VehicleAnalyticsTeaser /> : null}
              <LocationCard snapshot={snapshot} hasMounted={hasMounted} />
            </>
          ) : (
            <>
              <TelemetryGrid snapshot={snapshot} />
              <TripBrowser
                showDateFilter={Boolean(fixturePoints)}
                selectedDate={selectedDate}
                availableDateKeys={fixtureDateKeys}
                onDateChange={(value) => {
                  setSelectedDateOverride(value);
                  setSelectedTripId(undefined);
                }}
                trips={trips}
                selectedTripId={expandedTripId}
                onSelectTrip={(tripId) => {
                  setSelectedTripId((currentTripId) => {
                    const currentExpandedTripId = currentTripId === undefined ? defaultTripId : currentTripId;
                    return currentExpandedTripId === tripId ? null : tripId;
                  });
                }}
                isLoading={isTripsLoading}
                hasError={Boolean(tripsError)}
                expandedFixtureTrip={expandedFixtureTrip}
              />
              {!fixturePoints ? <VehicleAnalyticsTeaser /> : null}
              <LocationCard snapshot={snapshot} hasMounted={hasMounted} />
            </>
          )}
        </>
      )}
    </div>
  );
}

function Header() {
  const { t } = useTranslation();
  const tx = t as Translator;

  return (
    <header className="flex items-center justify-between gap-4">
      <LogoFull />
      <BrandBadge className="hidden min-[380px]:inline-flex">
        {tx("vehicle.badge")}
      </BrandBadge>
    </header>
  );
}

function heroStatusBadgeClass(mode: DashboardVehicleMode) {
  switch (mode) {
    case "stale":
      return "border-yellow-300/25 bg-yellow-300/10 text-yellow-200";
    case "live_charging":
    case "app_charging":
      return "border-cyan-300/25 bg-cyan-300/10 text-cyan-100";
    case "driving":
      return "border-cyan-300/25 bg-cyan-300/10 text-cyan-100";
    case "parked":
      return "border-emerald-300/25 bg-emerald-300/10 text-emerald-100";
    default:
      return "border-primary/25 bg-primary/10 text-primary";
  }
}

function Hero({
  snapshot,
  nowMs,
  vehicleMode,
  isStale,
  isCharging,
  rangeLabel,
  mathRangeLabel,
  vehicleLabel,
  hasMounted,
  distanceSinceChargeKm,
  kmPerPercentSoc,
}: {
  snapshot: BydmateLiveSnapshotRow;
  nowMs: number;
  vehicleMode: DashboardVehicleMode;
  isStale: boolean;
  isCharging: boolean;
  rangeLabel: string;
  mathRangeLabel: string;
  vehicleLabel: string;
  hasMounted: boolean;
  distanceSinceChargeKm: number | null;
  kmPerPercentSoc: number | null;
}) {
  const { locale, t: translate } = useTranslation();
  const t = translate as Translator;
  const telemetry = snapshot.telemetry;
  const coreMetrics = heroCoreMetrics(snapshot, t, locale);
  const primaryMetrics = [
    {
      key: "aiRange",
      icon: Route,
      label: t("vehicle.metrics.aiRange"),
      value: rangeLabel,
    },
    {
      key: "mathRange",
      icon: Activity,
      label: t("vehicle.metrics.mathRange"),
      value: mathRangeLabel,
    },
    coreMetrics[0],
    ...coreMetrics.slice(1),
  ];
  const sinceChargeValue = formatHeroDistanceKm(distanceSinceChargeKm);
  const kmPerPercentValue = formatKmPerPercent(kmPerPercentSoc);
  const driveMetrics = [
    {
      key: "kmPerPercent",
      icon: Activity,
      label: t("vehicle.metrics.kmPerPercent"),
      value: kmPerPercentValue,
    },
    {
      key: "sinceCharge",
      icon: Navigation,
      label: t("vehicle.metrics.sinceLastCharge"),
      value: sinceChargeValue,
    },
  ];

  return (
    <section className="voltflow-card overflow-hidden p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            {vehicleLabel}
          </p>
          <h1 className="mt-1.5 font-heading text-4xl font-bold tracking-normal tabular-nums">
            {fmt(telemetry.soc)}
            <span className="text-xl text-muted-foreground">%</span>
          </h1>
          <p className="mt-1 text-xs text-muted-foreground" suppressHydrationWarning>
            {hasMounted
              ? t("vehicle.lastUpdate", { value: timeAgo(snapshot.received_at, nowMs, t) })
              : "\u00a0"}
          </p>
        </div>
        <span
          className={
            "shrink-0 rounded-full border px-3 py-1.5 font-heading text-[10px] font-semibold uppercase tracking-[0.16em] " +
            heroStatusBadgeClass(vehicleMode)
          }
        >
          {t(vehicleStatusLabelKey(vehicleMode))}
        </span>
      </div>

      <div className={`mt-4 ${telemetryGridClass(primaryMetrics.length)}`}>
        {primaryMetrics.map((metric) => (
          <HeroMetric
            key={metric.key}
            icon={metric.icon}
            label={metric.label}
            value={metric.value}
          />
        ))}
      </div>

      {(() => {
        const modeMetrics: {
          key: string;
          icon: typeof Gauge;
          label: string;
          value: string;
        }[] = [];

        if (isStale) {
          modeMetrics.push(...driveMetrics);
        } else if (isCharging) {
          modeMetrics.push(
            {
              key: "chargePower",
              icon: Zap,
              label: t("vehicle.telemetry.chargePower"),
              value: `${fmt(telemetry.charge_power_kw, 1)} kW`,
            },
          );
        } else {
          modeMetrics.push(
            ...driveMetrics,
            {
              key: "speed",
              icon: Gauge,
              label: t("vehicle.metrics.speed"),
              value: `${fmt(telemetry.speed_kmh, 0)} km/h`,
            },
          );
        }

        const visibleModeMetrics = modeMetrics.filter((metric) => !isMissingMetricValue(metric.value));
        if (visibleModeMetrics.length === 0) return null;

        return (
          <div className={`mt-2 ${telemetryGridClass(visibleModeMetrics.length)}`}>
            {visibleModeMetrics.map((metric) => (
              <HeroMetric
                key={metric.key}
                icon={metric.icon}
                label={metric.label}
                value={metric.value}
              />
            ))}
          </div>
        );
      })()}
    </section>
  );
}

function HeroMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Gauge;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-white/[0.03] p-2.5">
      <Icon className="mb-1 size-3.5 text-primary" aria-hidden />
      <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-heading text-base font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function ChargingModeCard({ snapshot }: { snapshot: BydmateLiveSnapshotRow }) {
  const { t } = useTranslation();
  const tx = t as Translator;
  const telemetry = snapshot.telemetry;
  const items = [
    { icon: Zap, label: tx("vehicle.telemetry.chargePower"), value: `${fmt(telemetry.charge_power_kw, 1)} kW` },
    { icon: Activity, label: tx("vehicle.telemetry.chargeType"), value: telemetry.charge_type ?? "—" },
    { icon: Thermometer, label: tx("vehicle.telemetry.batteryTemp"), value: fmtTemp(telemetry.battery_temp_c) },
    { icon: Thermometer, label: tx("vehicle.telemetry.outsideTemp"), value: fmtTemp(telemetry.outside_temp_c) },
  ];

  return (
    <Card className="border-cyan-300/20 bg-cyan-300/[0.06]">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="flex items-center gap-2 font-heading text-base">
          <BatteryCharging className="size-5 text-cyan-100" aria-hidden />
          {tx("vehicle.chargingMode.title")}
        </CardTitle>
        <p className="pt-2 text-sm text-muted-foreground">
          {tx("vehicle.chargingMode.body")}
        </p>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-2 p-4 pt-0 min-[380px]:grid-cols-4">
        {items.map((item) => (
          <HeroMetric key={item.label} icon={item.icon} label={item.label} value={item.value} />
        ))}
      </CardContent>
    </Card>
  );
}

function StaleTelemetryNotice() {
  const { t } = useTranslation();
  const tx = t as Translator;

  return (
    <Card size="sm" className="border-yellow-300/20 bg-yellow-300/[0.06]">
      <CardContent className="px-4 py-3">
        <p className="font-heading text-base font-semibold tracking-tight text-yellow-100">
          {tx("vehicle.staleTitle")}
        </p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {tx("vehicle.staleBody")}
        </p>
      </CardContent>
    </Card>
  );
}

function TelemetryGrid({ snapshot }: { snapshot: BydmateLiveSnapshotRow }) {
  const { t } = useTranslation();
  const tx = t as Translator;
  const telemetry = snapshot.telemetry;
  const isCharging = Boolean(telemetry.is_charging);

  const items = useMemo(() => {
    const all: {
      key: string;
      icon: typeof Gauge;
      label: string;
      value: string;
      when?: "charging" | "driving";
    }[] = [
      {
        key: "chargeType",
        icon: Activity,
        label: tx("vehicle.telemetry.chargeType"),
        value: telemetry.charge_type ?? "—",
        when: "charging",
      },
      {
        key: "batteryTemp",
        icon: Thermometer,
        label: tx("vehicle.telemetry.batteryTemp"),
        value: fmtTemp(telemetry.battery_temp_c),
      },
      {
        key: "outsideTemp",
        icon: Thermometer,
        label: tx("vehicle.telemetry.outsideTemp"),
        value: fmtTemp(telemetry.outside_temp_c),
      },
      {
        key: "tripDistance",
        icon: Route,
        label: tx("vehicle.telemetry.tripDistance"),
        value: `${fmt(telemetry.current_trip_distance_km, 1)} km`,
        when: "driving",
      },
      {
        key: "tripConsumption",
        icon: Gauge,
        label: tx("vehicle.telemetry.tripConsumption"),
        value: `${fmt(telemetry.current_trip_consumption_kwh_100km, 1)} kWh/100`,
        when: "driving",
      },
      {
        key: "kwhCharged",
        icon: BatteryCharging,
        label: tx("vehicle.telemetry.kwhCharged"),
        value: `${fmt(telemetry.kwh_charged, 2)} kWh`,
        when: "charging",
      },
    ];

    return all.filter((item) => {
      if (item.when === "charging") {
        if (!isCharging) return false;
      } else if (item.when === "driving") {
        if (isCharging) return false;
      }
      return !isMissingMetricValue(item.value);
    });
  }, [isCharging, telemetry, tx]);

  if (items.length === 0) return null;

  return (
    <div className={telemetryGridClass(items.length)}>
      {items.map((item) => (
        <HeroMetric key={item.key} icon={item.icon} label={item.label} value={item.value} />
      ))}
    </div>
  );
}

type CellDeltaStatus = "good" | "warning" | "critical" | "unknown";

function diplusNumber(
  snapshot: BydmateLiveSnapshotRow,
  columnKey: "diplus_min_cell_voltage_v" | "diplus_max_cell_voltage_v" | "diplus_cell_delta_v",
  rawKey: "min_cell_voltage_v" | "max_cell_voltage_v" | "cell_delta_v",
  telemetryKeys: Array<keyof BydmateTelemetry> = [],
) {
  const columnValue = snapshot[columnKey];
  if (typeof columnValue === "number" && Number.isFinite(columnValue)) return columnValue;

  for (const key of telemetryKeys) {
    const telemetryValue = snapshot.telemetry[key];
    if (typeof telemetryValue === "number" && Number.isFinite(telemetryValue)) return telemetryValue;
  }

  const rawValue = snapshot.diplus?.[rawKey];
  return typeof rawValue === "number" && Number.isFinite(rawValue) ? rawValue : null;
}

function cellDeltaStatus(delta: number | null): CellDeltaStatus {
  if (delta == null) return "unknown";
  if (delta <= 0.03) return "good";
  if (delta <= 0.05) return "warning";
  return "critical";
}

function cellStatusClasses(status: CellDeltaStatus) {
  if (status === "good") return "border-emerald-300/25 bg-emerald-300/10 text-emerald-100";
  if (status === "warning") return "border-yellow-300/25 bg-yellow-300/10 text-yellow-100";
  if (status === "critical") return "border-red-300/25 bg-red-300/10 text-red-100";
  return "border-border bg-white/[0.03] text-muted-foreground";
}

function CellHealthCard({ snapshot }: { snapshot: BydmateLiveSnapshotRow }) {
  const { t } = useTranslation();
  const tx = t as Translator;
  const minCellVoltage = diplusNumber(snapshot, "diplus_min_cell_voltage_v", "min_cell_voltage_v", [
    "diplus_min_cell_voltage_v",
    "cell_voltage_min_v",
  ]);
  const maxCellVoltage = diplusNumber(snapshot, "diplus_max_cell_voltage_v", "max_cell_voltage_v", [
    "diplus_max_cell_voltage_v",
    "cell_voltage_max_v",
  ]);
  const storedCellDelta = diplusNumber(snapshot, "diplus_cell_delta_v", "cell_delta_v", [
    "diplus_cell_delta_v",
    "cell_delta_v",
  ]);
  const cellDelta = storedCellDelta ?? (
    minCellVoltage != null && maxCellVoltage != null ? maxCellVoltage - minCellVoltage : null
  );
  const status = cellDeltaStatus(cellDelta);
  const items = [
    { label: tx("vehicle.cellHealth.min"), value: `${fmt(minCellVoltage, 3)} V` },
    { label: tx("vehicle.cellHealth.max"), value: `${fmt(maxCellVoltage, 3)} V` },
    { label: tx("vehicle.cellHealth.delta"), value: `${fmt(cellDelta, 3)} V` },
  ];

  return (
    <Card size="sm" className={`border ${cellStatusClasses(status)}`}>
      <CardHeader className="flex-row items-center justify-between space-y-0 px-3 pt-2 pb-1">
        <CardTitle className="flex items-center gap-1.5 font-heading text-sm">
          <HeartPulse className="size-4" aria-hidden />
          {tx("vehicle.cellHealth.title")}
        <span className="rounded-full border border-current/20 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]">
          {tx(`vehicle.cellHealth.status.${status}`)}
        </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-3 gap-2 px-3 pb-3 pt-0">
        {items.map((item) => (
          <div key={item.label} className="rounded-xl border border-current/10 bg-black/10 p-2">
            <p className="text-[10px] uppercase tracking-[0.14em] opacity-75">{item.label}</p>
            <p className="mt-0.5 font-heading text-sm font-semibold tabular-nums">{item.value}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

type ChartPoint = {
  time: number;
  value: number;
  powerKw?: number | null;
  /** Distance from trip start in km — populated only in trip mode */
  distanceKm?: number | null;
};

type RoutePoint = {
  lat: number;
  lon: number;
  time: number;
  powerKw: number | null;
  speedKmh: number | null;
  soc: number | null;
};

type MapTile = {
  key: string;
  url: string;
  x: number;
  y: number;
};

type MapPan = {
  x: number;
  y: number;
};

type RouteLayer = "route" | "power" | "speed" | "soc";

type ChartSeries = {
  label: string;
  color: string;
  points: ChartPoint[];
  unit?: string;
  valueDigits?: number;
};

type ChartTier = "base" | "diagnostic";

type TelemetryChart = {
  title: string;
  unit: string;
  valueDigits: number;
  tier: ChartTier;
  series: ChartSeries[];
  minValue: number;
  maxValue: number;
  minTime: number;
  maxTime: number;
  minDistanceKm: number;
  maxDistanceKm: number;
  hasData: boolean;
  hasDistanceData: boolean;
};

type RegenRecoveryChartModel = {
  title: string;
  unit: string;
  valueDigits: number;
  xAxis: "distance" | "time";
  segments: Array<{ x: number; regenKwh: number }>;
  hasData: boolean;
};

type DeltaBySocPoint = {
  soc: number;
  delta: number;
  time: number;
};

type DeltaBySocChartModel = {
  points: DeltaBySocPoint[];
  minSoc: number;
  maxSoc: number;
  minDelta: number;
  maxDelta: number;
  latest: DeltaBySocPoint | null;
  socDirection: "charge" | "discharge";
};

type TripSegment = {
  id: string;
  points: BydmateTelemetryPointRow[];
  startMs: number;
  endMs: number;
  durationMs: number;
  distanceKm: number | null;
  socStart: number | null;
  socEnd: number | null;
  maxSpeed: number | null;
  avgSpeed: number | null;
  avgConsumptionKwh100Km: number | null;
};

const TRIP_GAP_MS = 5 * 60 * 1000;
const MAX_CHART_POINTS = 240;
const MAX_TRIP_CHART_POINTS = MAX_TELEMETRY_CHART_POINTS;
const MAX_CHART_MARKERS = 80;
const MAX_DELTA_BY_SOC_POINTS = 240;
const MAX_ROUTE_POINTS = 2000;
const MAP_VIEW_WIDTH = 320;
const MAP_VIEW_HEIGHT = 180;
const ROUTE_MAP_PAD_X = 16;
const ROUTE_MAP_PAD_Y = 12;
const ROUTE_MAP_INNER_WIDTH = MAP_VIEW_WIDTH - ROUTE_MAP_PAD_X * 2;
const ROUTE_MAP_INNER_HEIGHT = MAP_VIEW_HEIGHT - ROUTE_MAP_PAD_Y * 2;
const MAP_TILE_SIZE = 256;
const MAX_MAP_ZOOM = 19;
const MIN_MAP_ZOOM = 2;
const DEFAULT_MAP_ZOOM = 15;
const WEB_MERCATOR_MAX_LAT = 85.05112878;
const ROUTE_LINE_COLOR = "#1e40af";
const ROUTE_STROKE_WIDTH = 4;
const ROUTE_HIT_RADIUS = 10;
const REGEN_POWER_THRESHOLD_KW = 0.05;
const COAST_POWER_COLOR = "#475569";
const ROUTE_LAYER_OPTIONS: Array<{
  id: RouteLayer;
  label: string;
  color: string;
}> = [
  { id: "route", label: "Route", color: ROUTE_LINE_COLOR },
  { id: "power", label: "Power", color: "#ef4444" },
  { id: "speed", label: "Speed", color: "#22c55e" },
  { id: "soc", label: "SOC", color: "#facc15" },
];

function validNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function validTempNumber(value: number | null | undefined) {
  const n = validNumber(value);
  return n != null && n >= -50 && n <= 90 ? n : null;
}

function pointTimeMs(point: { device_time: string; received_at?: string }) {
  const deviceMs = Date.parse(point.device_time);
  if (Number.isFinite(deviceMs)) return deviceMs;
  const receivedMs = point.received_at ? Date.parse(point.received_at) : Number.NaN;
  return Number.isFinite(receivedMs) ? receivedMs : 0;
}

type TelemetryChartSource = {
  device_time: string;
  received_at?: string;
  telemetry: BydmateTelemetry;
  diplus?: BydmateDiplus;
  diplus_min_cell_voltage_v?: number | null;
  diplus_max_cell_voltage_v?: number | null;
  diplus_cell_delta_v?: number | null;
  regen_kwh_sum?: number | null;
  traction_kwh_sum?: number | null;
  location?: BydmateLocation;
  hourly?: {
    soc_min: number | null;
    soc_max: number | null;
  };
};

function pad2(value: number) {
  return value.toString().padStart(2, "0");
}

function localDateKey(ms: number) {
  const date = new Date(ms);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function formatClock(ms: number) {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDuration(ms: number) {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function buildTrips(points: BydmateTelemetryPointRow[]): TripSegment[] {
  const sorted = [...points]
    .filter(
      (point) =>
        pointTimeMs(point) > 0 &&
        !isTelemetryCharging(point.telemetry, point) &&
        !gearIsPark(readGear(point)),
    )
    .sort((a, b) => pointTimeMs(a) - pointTimeMs(b));

  const groups: BydmateTelemetryPointRow[][] = [];
  for (const point of sorted) {
    const lastGroup = groups.at(-1);
    const previous = lastGroup?.at(-1);
    if (!lastGroup || !previous || pointTimeMs(point) - pointTimeMs(previous) > TRIP_GAP_MS) {
      groups.push([point]);
    } else {
      lastGroup.push(point);
    }
  }

  const validGroups = groups.filter((tripPoints) => {
    // Exclude trips with only a single point
    if (tripPoints.length < 2) return false;
    // Exclude trips where the car was not moving for 5+ minutes
    const durationMs = pointTimeMs(tripPoints.at(-1)!) - pointTimeMs(tripPoints[0]);
    if (durationMs >= TRIP_GAP_MS) {
      const speeds = tripPoints
        .map((point) => validNumber(point.telemetry.speed_kmh))
        .filter((value): value is number => value != null);
      const maxSpeed = speeds.length ? Math.max(...speeds) : null;
      if (maxSpeed === null || maxSpeed === 0) return false;
    }
    return true;
  });

  return validGroups.map((tripPoints, index) => {
    const startMs = pointTimeMs(tripPoints[0]);
    const endMs = pointTimeMs(tripPoints.at(-1) ?? tripPoints[0]);
    const speeds = tripPoints
      .map((point) => validNumber(point.telemetry.speed_kmh))
      .filter((value): value is number => value != null);
    const consumptionValues = tripPoints
      .map((point) => validNumber(point.telemetry.current_trip_consumption_kwh_100km))
      .filter((value): value is number => value != null && value >= 0);
    const odometerValues = tripPoints
      .map((point) => validNumber(point.telemetry.odometer_km))
      .filter((value): value is number => value != null);
    const tripDistanceValues = tripPoints
      .map((point) => validNumber(point.telemetry.current_trip_distance_km))
      .filter((value): value is number => value != null);
    const odometerDistance =
      odometerValues.length > 1 ? odometerValues.at(-1)! - odometerValues[0] : null;
    const tripDistance =
      tripDistanceValues.length > 0 ? Math.max(...tripDistanceValues) - Math.min(...tripDistanceValues) : null;
    const gpsCoords = tripPoints
      .map((point) => {
        const lat = validNumber(point.location?.lat);
        const lon = validNumber(point.location?.lon);
        return lat != null && lon != null ? { lat, lon } : null;
      })
      .filter((point): point is { lat: number; lon: number } => point != null);
    const distanceKm = resolvePreferredTripDistanceKm({
      gpsDistanceKm: trackPathDistanceKm(gpsCoords),
      odometerDistanceKm: odometerDistance,
      tripCounterDistanceKm: tripDistance,
    });

    return {
      id: `${startMs}-${index}`,
      points: tripPoints,
      startMs,
      endMs,
      durationMs: Math.max(0, endMs - startMs),
      distanceKm,
      socStart: validNumber(tripPoints[0]?.telemetry.soc),
      socEnd: validNumber(tripPoints.at(-1)?.telemetry.soc),
      maxSpeed: speeds.length ? Math.max(...speeds) : null,
      avgSpeed: speeds.length ? speeds.reduce((sum, value) => sum + value, 0) / speeds.length : null,
      avgConsumptionKwh100Km: consumptionValues.length
        ? consumptionValues.reduce((sum, value) => sum + value, 0) / consumptionValues.length
        : null,
    };
  }).reverse();
}

function tripRowFromFixture(trip: TripSegment, vehicleId: string): BydmateTripRow {
  return {
    id: trip.id,
    user_id: "fixture",
    vehicle_id: vehicleId,
    started_at: new Date(trip.startMs).toISOString(),
    ended_at: new Date(trip.endMs).toISOString(),
    last_device_time: new Date(trip.endMs).toISOString(),
    sample_count: trip.points.length,
    track_point_count: trip.points.filter(
      (point) => typeof point.location.lat === "number" && typeof point.location.lon === "number",
    ).length,
    distance_km: trip.distanceKm,
    soc_start: trip.socStart,
    soc_end: trip.socEnd,
    max_speed_kmh: trip.maxSpeed,
    avg_speed_kmh: trip.avgSpeed,
    avg_consumption_kwh_100km: trip.avgConsumptionKwh100Km,
  };
}

function formatTripCostStr(
  trip: BydmateTripRow,
  currency: Currency,
  pricePerKwh: number,
  locale: Locale,
): string | null {
  const distanceKm = trip.distance_km;
  const energyKwh =
    typeof trip.traction_energy_kwh === "number" && Number.isFinite(trip.traction_energy_kwh)
      ? trip.traction_energy_kwh
      : distanceKm != null && trip.avg_consumption_kwh_100km != null
        ? (distanceKm * trip.avg_consumption_kwh_100km) / 100
        : null;
  const costValue =
    energyKwh != null && pricePerKwh > 0 ? energyKwh * pricePerKwh : null;

  return costValue != null
    ? formatCurrencyAmount(currency, costValue, locale, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : null;
}

function ExpandedTripPanel({
  tripId,
  trip,
}: {
  tripId: string;
  trip: BydmateTripRow;
}) {
  const {
    data: samples = [],
    isLoading: isSamplesLoading,
    error: samplesError,
  } = useBydmateTripSamplesQuery(tripId);
  const {
    data: track = [],
    isLoading: isTrackLoading,
    error: trackError,
  } = useBydmateTripTrackQuery(tripId);
  const odometerDistanceKm = useMemo(
    () => odometerDeltaFromSamples(samples) ?? trip.distance_km,
    [samples, trip.distance_km],
  );
  const showRouteMap = useMemo(
    () => isRouteTrackDisplayable(track, 2, 75, { odometerDistanceKm }),
    [track, odometerDistanceKm],
  );

  return (
    <>
      <TelemetryHistoryCharts
        points={samples}
        isLoading={isSamplesLoading}
        hasError={Boolean(samplesError)}
        embedded
      />
      {showRouteMap || isTrackLoading || trackError || track.length === 0 ? (
        <RouteMap trackPoints={track} isLoading={isTrackLoading} hasError={Boolean(trackError)} embedded />
      ) : null}
    </>
  );
}

function TripBrowser({
  showDateFilter = false,
  selectedDate = "",
  availableDateKeys = [],
  onDateChange,
  trips,
  selectedTripId,
  onSelectTrip,
  isLoading,
  hasError,
  expandedFixtureTrip,
}: {
  showDateFilter?: boolean;
  selectedDate?: string;
  availableDateKeys?: string[];
  onDateChange?: (value: string) => void;
  trips: BydmateTripRow[];
  selectedTripId: string | null;
  onSelectTrip: (id: string) => void;
  isLoading: boolean;
  hasError: boolean;
  expandedFixtureTrip: TripSegment | null;
}) {
  const { locale, t } = useTranslation();
  const tx = t as Translator;
  const totalDistance = trips.reduce((sum, trip) => sum + (trip.distance_km ?? 0), 0);
  const fixtureTripEnergy = expandedFixtureTrip
    ? calculateTripEnergy(expandedFixtureTrip.points.map((point) => ({
        device_time: point.device_time,
        power_kw: point.telemetry?.power_kw,
      })))
    : null;
  const totalRegenEnergy = trips.reduce((sum, trip) => {
    const fallbackRegen =
      fixtureTripEnergy && expandedFixtureTrip?.id === trip.id
        ? fixtureTripEnergy.regen_energy_kwh
        : null;
    return sum + (trip.regen_energy_kwh ?? fallbackRegen ?? 0);
  }, 0);
  const avgConsumption = averageTripConsumption(trips);

  return (
    <section className="voltflow-card p-5">
      <div className={showDateFilter ? "flex flex-wrap items-end justify-between gap-4" : undefined}>
        <div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight">
            {tx("vehicle.trips.title")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {tx("vehicle.trips.subtitle")}
          </p>
        </div>
        {showDateFilter ? (
          <label className="grid gap-1 text-sm text-muted-foreground">
            {tx("vehicle.trips.date")}
            <Input
              type="date"
              value={selectedDate}
              onChange={(event) => onDateChange?.(event.target.value)}
              className="w-44"
            />
          </label>
        ) : null}
      </div>

      {showDateFilter && availableDateKeys.length > 0 ? (
        <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
          {availableDateKeys.slice(0, 14).map((dateKey) => {
            const selected = dateKey === selectedDate;
            const date = new Date(`${dateKey}T12:00:00`);
            return (
              <button
                key={dateKey}
                type="button"
                onClick={() => onDateChange?.(dateKey)}
                className={
                  "shrink-0 rounded-full border px-3 py-2 text-sm transition " +
                  (selected
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border bg-white/[0.03] text-muted-foreground hover:border-primary/50 hover:text-foreground")
                }
                title={tx("vehicle.trips.dateHasTelemetry", { date: dateKey })}
              >
                <span className="font-heading font-semibold">
                  {date.toLocaleDateString(localeCode(locale), { month: "short", day: "numeric" })}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="mt-5 grid grid-cols-2 gap-3 min-[100px]:grid-cols-3">
        <SummaryPill label={tx("vehicle.trips.count")} value={isLoading ? "…" : String(trips.length)} />
        <SummaryPill label={tx("vehicle.trips.distance")} value={`${fmt(totalDistance, 1)} km`} />
        <SummaryPill label={tx("vehicle.trips.regen")} value={`${fmt(totalRegenEnergy, 2)} kWh`} />
        <SummaryPill label={tx("vehicle.trips.consumption")} value={`${fmt(avgConsumption, 1)} kWh/100`} />
        <SummaryPill
          label={tx("vehicle.trips.points")}
          value={String(trips.reduce((sum, trip) => sum + trip.sample_count, 0))}
        />
      </div>

      {hasError ? (
        <p className="mt-5 rounded-2xl border border-border bg-white/[0.03] p-4 text-sm text-muted-foreground">
          {tx("vehicle.errors.trips")}
        </p>
      ) : trips.length === 0 ? (
        <p className="mt-5 rounded-2xl border border-border bg-white/[0.03] p-4 text-sm text-muted-foreground">
          {tx("vehicle.trips.empty")}
        </p>
      ) : (
        <div className="mt-5 grid gap-3">
          {trips.map((trip, index) => {
            const tripLabel = tx("vehicle.trips.tripLabel", { value: trips.length - index });
            const expanded = trip.id === selectedTripId;
            const displayTrip =
              fixtureTripEnergy && expandedFixtureTrip?.id === trip.id
                ? {
                    ...trip,
                    ...fixtureTripEnergy,
                  }
                : trip;

            return (
              <div key={trip.id} className="grid gap-3">
                <TripListItem
                  trip={displayTrip}
                  tripLabel={tripLabel}
                  expanded={expanded}
                  onSelect={() => onSelectTrip(trip.id)}
                />
                {expanded ? (
                  expandedFixtureTrip && expandedFixtureTrip.id === trip.id ? (
                    <>
                      <TelemetryHistoryCharts
                        points={expandedFixtureTrip.points}
                        isLoading={false}
                        hasError={false}
                        embedded
                      />
                      <RouteMap points={expandedFixtureTrip.points} embedded />
                    </>
                  ) : (
                    <ExpandedTripPanel tripId={trip.id} trip={trip} />
                  )
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function TripListItem({
  trip,
  tripLabel,
  expanded,
  onSelect,
}: {
  trip: BydmateTripRow;
  tripLabel: string;
  expanded: boolean;
  onSelect: () => void;
}) {
  const startMs = Date.parse(trip.started_at);
  const endMs = Date.parse(trip.ended_at ?? trip.last_device_time);
  const durationMs = Math.max(0, endMs - startMs);
  const { locale, t } = useTranslation();
  const tx = t as Translator;
  const currency = useAppPreferences((s) => s.currency) as Currency;
  const pricePerKwh = useAppPreferences((s) => s.defaultPricePerKwh);
  const costStr = formatTripCostStr(trip, currency, pricePerKwh, locale as Locale);

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={onSelect}
        aria-expanded={false}
        className="grid min-h-14 grid-cols-[auto_1fr_auto] items-center gap-3 rounded-2xl border border-border bg-white/[0.02] px-4 py-3 text-left transition hover:border-primary/50 hover:bg-white/[0.04]"
      >
        <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
        <div className="min-w-0">
          <p className="truncate font-heading text-base font-semibold tracking-tight">
            {tripLabel}
          </p>
          <p className="truncate text-sm text-muted-foreground">
            {formatClock(startMs)} - {formatClock(endMs)} · {formatDuration(durationMs)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-sm tabular-nums text-muted-foreground">
          <span className="text-emerald-300">{fmt(trip.regen_energy_kwh, 2)} kWh</span>
          <span>{fmt(trip.distance_km, 1)} km</span>
          <span className="hidden min-[430px]:inline">
            {tx("vehicle.trips.pointShort", { value: trip.sample_count })}
          </span>
        </div>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-expanded
      className="rounded-2xl border border-primary bg-primary/10 p-4 text-left transition"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <ChevronDown className="mt-1 size-4 shrink-0 text-primary" aria-hidden />
          <div>
            <p className="font-heading text-lg font-semibold tracking-tight">
              {tripLabel}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {formatClock(startMs)} - {formatClock(endMs)} · {formatDuration(durationMs)}
            </p>
          </div>
        </div>
        <span className="rounded-full border border-border bg-background/40 px-3 py-1 text-xs uppercase tracking-[0.18em] text-muted-foreground">
          {tx("vehicle.trips.pointShort", { value: trip.sample_count })}
        </span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 min-[430px]:grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))]">
        <MiniStat label={tx("vehicle.trips.distance")} value={`${fmt(trip.distance_km, 1)} km`} />
        <MiniStat label={tx("vehicle.trips.regen")} value={`${fmt(trip.regen_energy_kwh, 2)} kWh`} />
        <MiniStat label={tx("vehicle.trips.traction")} value={`${fmt(trip.traction_energy_kwh, 2)} kWh`} />
        <MiniStat label="SOC" value={`${fmt(trip.soc_start)}% -> ${fmt(trip.soc_end)}%`} />
        <MiniStat
          label={tx("vehicle.trips.consumption")}
          value={`${fmt(trip.avg_consumption_kwh_100km, 1)} kWh/100`}
        />
        <MiniStat label={tx("vehicle.trips.maxSpeed")} value={`${fmt(trip.max_speed_kmh)} km/h`} />
        <MiniStat label={tx("vehicle.trips.avgSpeed")} value={`${fmt(trip.avg_speed_kmh)} km/h`} />
        {costStr != null ? (
          <MiniStat label={tx("vehicle.trips.cost")} value={costStr} />
        ) : null}
      </div>
    </button>
  );
}

function SummaryPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-white/[0.02] p-3 mx-auto w-fit">
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-center font-heading text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-1 font-heading text-base font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function downsamplePoints<T>(points: T[], maxPoints: number) {
  if (points.length <= maxPoints) return points;
  if (maxPoints <= 1) return points.slice(0, 1);

  const lastIndex = points.length - 1;
  const sampled: T[] = [];
  let previousIndex = -1;

  for (let index = 0; index < maxPoints; index += 1) {
    const sourceIndex = Math.round((index * lastIndex) / (maxPoints - 1));
    if (sourceIndex !== previousIndex) {
      sampled.push(points[sourceIndex]);
      previousIndex = sourceIndex;
    }
  }

  return sampled;
}

function finalizeChart(chart: TelemetryChart, maxPoints = MAX_CHART_POINTS): TelemetryChart {
  const series = chart.series
    .map((item) => ({
      ...item,
      points: downsamplePoints(item.points, maxPoints),
    }))
    .filter((item) => item.points.length > 0);

  if (series.length === 0) {
    return {
      ...chart,
      series,
      hasData: false,
      minValue: 0,
      maxValue: 1,
      minTime: 0,
      maxTime: 1,
      minDistanceKm: 0,
      maxDistanceKm: 0,
      hasDistanceData: false,
    };
  }

  let minValue = Infinity;
  let maxValue = -Infinity;
  let minTime = Infinity;
  let maxTime = -Infinity;
  let minDistanceKm = Infinity;
  let maxDistanceKm = -Infinity;
  let hasDistanceData = false;

  for (const item of series) {
    for (const point of item.points) {
      minValue = Math.min(minValue, point.value);
      maxValue = Math.max(maxValue, point.value);
      minTime = Math.min(minTime, point.time);
      maxTime = Math.max(maxTime, point.time);
      if (point.distanceKm != null) {
        minDistanceKm = Math.min(minDistanceKm, point.distanceKm);
        maxDistanceKm = Math.max(maxDistanceKm, point.distanceKm);
        hasDistanceData = true;
      }
    }
  }

  return {
    ...chart,
    series,
    hasData: true,
    minValue,
    maxValue,
    minTime,
    maxTime,
    minDistanceKm: hasDistanceData ? minDistanceKm : 0,
    maxDistanceKm: hasDistanceData ? maxDistanceKm : 0,
    hasDistanceData,
  };
}

function createChart(
  title: string,
  unit: string,
  series: ChartSeries[],
  valueDigits = 1,
  tier: ChartTier = "base",
): TelemetryChart {
  return {
    title,
    unit,
    valueDigits,
    tier,
    series,
    minValue: 0,
    maxValue: 1,
    minTime: 0,
    maxTime: 1,
    minDistanceKm: 0,
    maxDistanceKm: 0,
    hasData: false,
    hasDistanceData: false,
  };
}

function addChartPoint(
  chart: TelemetryChart,
  seriesIndex: number,
  time: number,
  value: number | null,
  distanceKm?: number | null,
) {
  if (value == null || !Number.isFinite(time)) return;

  chart.series[seriesIndex].points.push({ time, value, distanceKm });
  chart.minValue = chart.hasData ? Math.min(chart.minValue, value) : value;
  chart.maxValue = chart.hasData ? Math.max(chart.maxValue, value) : value;
  chart.minTime = chart.hasData ? Math.min(chart.minTime, time) : time;
  chart.maxTime = chart.hasData ? Math.max(chart.maxTime, time) : time;
  chart.hasData = true;
}

function addDeltaBySocPoint(points: DeltaBySocPoint[], time: number, soc: number | null, delta: number | null) {
  if (soc == null || delta == null || !Number.isFinite(time)) return;
  points.push({ soc, delta, time });
}

function cellDeltaValue(point: TelemetryChartSource) {
  const columnValue = validNumber(point.diplus_cell_delta_v);
  if (columnValue != null) return columnValue;

  const telemetryValue =
    validNumber(point.telemetry.diplus_cell_delta_v) ??
    validNumber(point.telemetry.cell_delta_v);
  if (telemetryValue != null) return telemetryValue;

  const rawValue = validNumber(point.diplus?.cell_delta_v);
  if (rawValue != null) return rawValue;

  const min = validNumber(point.diplus_min_cell_voltage_v) ??
    validNumber(point.telemetry.diplus_min_cell_voltage_v) ??
    validNumber(point.telemetry.cell_voltage_min_v) ??
    validNumber(point.diplus?.min_cell_voltage_v);
  const max = validNumber(point.diplus_max_cell_voltage_v) ??
    validNumber(point.telemetry.diplus_max_cell_voltage_v) ??
    validNumber(point.telemetry.cell_voltage_max_v) ??
    validNumber(point.diplus?.max_cell_voltage_v);

  return min != null && max != null ? max - min : null;
}

function prepareDeltaBySoc(
  points: DeltaBySocPoint[],
  socDirection: DeltaBySocChartModel["socDirection"],
): DeltaBySocChartModel {
  const sampled = downsamplePoints(points, MAX_DELTA_BY_SOC_POINTS);
  if (sampled.length === 0) {
    return {
      points: [],
      minSoc: 0,
      maxSoc: 100,
      minDelta: 0,
      maxDelta: 1,
      latest: null,
      socDirection,
    };
  }

  return {
    points: sampled,
    minSoc: Math.min(...sampled.map((point) => point.soc)),
    maxSoc: Math.max(...sampled.map((point) => point.soc)),
    minDelta: Math.min(...sampled.map((point) => point.delta)),
    maxDelta: Math.max(...sampled.map((point) => point.delta)),
    latest: sampled.at(-1) ?? null,
    socDirection,
  };
}

/** Mate trip samples are sparse; default line-gap logic splits every segment. */
function deltaBySocTripLineGapMs(
  points: DeltaBySocPoint[],
  fallbackGapMs: number,
) {
  if (points.length < 2) return fallbackGapMs;
  const minTime = Math.min(...points.map((point) => point.time));
  const maxTime = Math.max(...points.map((point) => point.time));
  if (maxTime <= minTime) return fallbackGapMs;
  const avgGapMs = (maxTime - minTime) / (points.length - 1);
  return Math.max(fallbackGapMs, avgGapMs * 2.5);
}

function prepareTelemetryHistory(
  points: TelemetryChartSource[],
  t: Translator,
  options?: { includeCellDelta?: boolean; maxChartPoints?: number },
) {
  const includeCellDelta = options?.includeCellDelta !== false;
  const maxChartPoints = options?.maxChartPoints ?? MAX_CHART_POINTS;
  const socChart = createChart(t("vehicle.charts.soc"), "%", [
    { label: "SOC", color: "var(--voltflow-cyan)", points: [] },
  ], 1, "base");
  const speedPowerChart = createChart(t("vehicle.charts.speedPower"), "", [
    {
      label: t("vehicle.metrics.speed"),
      color: "#7dd3fc",
      points: [],
      unit: "km/h",
      valueDigits: 0,
    },
    {
      label: t("vehicle.metrics.power"),
      color: "#facc15",
      points: [],
      unit: "kW",
      valueDigits: 1,
    },
  ], 1, "base");
  const temperatureChart = createChart(t("vehicle.charts.temperatures"), "°C", [
    { label: t("vehicle.charts.battery"), color: "#22c55e", points: [] },
    { label: t("vehicle.charts.outside"), color: "#38bdf8", points: [] },
    { label: t("vehicle.charts.cabin"), color: "#fb7185", points: [] },
  ], 1, "diagnostic");
  const cellDeltaChart = createChart(t("vehicle.charts.cellDelta"), "V", [
    { label: "Delta", color: "#fb7185", points: [] },
  ], 3, "diagnostic");
  const deltaBySocPoints: DeltaBySocPoint[] = [];
  let hasCellDeltaData = false;

  let visiblePointCount = 0;
  let start: string | undefined;
  let end: string | undefined;
  const deviceTimes: string[] = [];
  // Distance tracking: use current_trip_distance_km if available, else odometer delta
  const firstOdometerKm = validNumber(
    points.find((point) => point.telemetry?.odometer_km != null)?.telemetry?.odometer_km,
  );

  for (const point of points) {
    if (!point.telemetry) continue;

    visiblePointCount += 1;
    start ??= point.device_time;
    end = point.device_time;
    deviceTimes.push(point.device_time);

    const time = pointTimeMs(point);
    const soc = validNumber(point.telemetry.soc);
    const cellDelta = cellDeltaValue(point);

    // Prefer current_trip_distance_km; fall back to odometer delta from first sample
    const tripDistKm = validNumber(point.telemetry.current_trip_distance_km);
    const odometerKm = validNumber(point.telemetry.odometer_km);
    const distanceKm =
      tripDistKm ??
      (firstOdometerKm != null && odometerKm != null
        ? Math.max(0, odometerKm - firstOdometerKm)
        : null);

    addChartPoint(socChart, 0, time, soc, distanceKm);
    addChartPoint(speedPowerChart, 0, time, validNumber(point.telemetry.speed_kmh), distanceKm);
    addChartPoint(speedPowerChart, 1, time, validNumber(point.telemetry.power_kw), distanceKm);
    addChartPoint(temperatureChart, 0, time, validTempNumber(point.telemetry.battery_temp_c), distanceKm);
    addChartPoint(temperatureChart, 1, time, validTempNumber(point.telemetry.outside_temp_c), distanceKm);
    addChartPoint(temperatureChart, 2, time, validTempNumber(point.telemetry.cabin_temp_c), distanceKm);
    if (includeCellDelta) {
      addChartPoint(cellDeltaChart, 0, time, cellDelta, distanceKm);
      addDeltaBySocPoint(deltaBySocPoints, time, soc, cellDelta);
      if (cellDelta != null) hasCellDeltaData = true;
    }
  }

  const hourlyRegen = points.some((point) => typeof point.regen_kwh_sum === "number");
  let regenRecoverySegments;
  if (hourlyRegen) {
    const startOdometerKm = validNumber(points[0]?.telemetry?.odometer_km);
    regenRecoverySegments = points
      .map((point) => {
        const regenKwh = point.regen_kwh_sum ?? 0;
        if (regenKwh <= 0) return null;
        const tripDistance = validNumber(point.telemetry?.current_trip_distance_km);
        const odometerKm = validNumber(point.telemetry?.odometer_km);
        const distanceKm =
          tripDistance ??
          (startOdometerKm != null && odometerKm != null ? Math.max(0, odometerKm - startOdometerKm) : null);
        return {
          time: pointTimeMs(point),
          distanceKm,
          regenKwh,
          powerKw: validNumber(point.telemetry?.power_kw),
        };
      })
      .filter((segment): segment is NonNullable<typeof segment> => segment != null);
  } else {
    regenRecoverySegments = calculateRegenRecoverySegments(
      points.map((sample) => ({
        device_time: sample.device_time,
        power_kw: sample.telemetry?.power_kw,
        current_trip_distance_km: sample.telemetry?.current_trip_distance_km,
        odometer_km: sample.telemetry?.odometer_km,
      })),
    );
  }

  const regenBars = prepareRegenRecoveryBars(regenRecoverySegments);
  const regenRecoveryChart: RegenRecoveryChartModel = {
    title: t("vehicle.charts.regen"),
    unit: "kWh",
    valueDigits: 2,
    xAxis: regenBars.xAxis,
    segments: regenBars.segments,
    hasData: regenBars.hasData,
  };

  const includesCellDeltaChart = includeCellDelta && hasCellDeltaData;
  const charts = [
    socChart,
    speedPowerChart,
    temperatureChart,
    // Cell Delta time-series removed — Delta by SOC below captures the same signal more usefully
  ].map((chart) => finalizeChart(chart, maxChartPoints));

  let minTime = Infinity;
  let maxTime = -Infinity;
  let hasData = false;
  for (const chart of charts) {
    if (!chart.hasData) continue;
    hasData = true;
    minTime = Math.min(minTime, chart.minTime);
    maxTime = Math.max(maxTime, chart.maxTime);
  }

  return {
    visiblePointCount,
    medianGapSeconds: medianSampleGapSeconds(deviceTimes),
    start,
    end,
    minTime: hasData ? minTime : 0,
    maxTime: hasData ? maxTime : 1,
    hasData,
    charts,
    regenRecoveryChart,
    deltaBySoc: includesCellDeltaChart
      ? prepareDeltaBySoc(deltaBySocPoints, "discharge")
      : { points: [], minSoc: 0, maxSoc: 100, minDelta: 0, maxDelta: 0, latest: null, socDirection: "discharge" as const },
  };
}

export function TelemetryHistoryCharts({
  points,
  isLoading,
  hasError,
  embedded = false,
  chartMode = "trip",
  historyRange,
  anchorDate,
  barCharts,
}: {
  points: TelemetryChartSource[];
  isLoading: boolean;
  hasError: boolean;
  embedded?: boolean;
  chartMode?: "trip" | "analytics";
  historyRange?: TelemetryHistoryRange;
  anchorDate?: string;
  barCharts?: BarChartModel[];
}) {
  const { locale, t } = useTranslation();
  const tx = t as Translator;
  const [tripXAxis, setTripXAxis] = useState<"time" | "distance">("time");
  const includeCellDelta = chartMode === "trip";
  const isAnalyticsDay = chartMode === "analytics" && historyRange === "day";
  const maxChartPoints =
    chartMode === "trip" || isAnalyticsDay ? MAX_TRIP_CHART_POINTS : MAX_CHART_POINTS;
  const history = useMemo(
    () => prepareTelemetryHistory(points, tx, { includeCellDelta, maxChartPoints }),
    [points, tx, includeCellDelta, maxChartPoints],
  );
  const lineGapMs = useMemo(
    () =>
      chartLineGapMs(
        history.medianGapSeconds,
        history.hasData ? history.minTime : undefined,
        history.hasData ? history.maxTime : undefined,
        history.visiblePointCount,
      ),
    [history.medianGapSeconds, history.minTime, history.maxTime, history.visiblePointCount, history.hasData],
  );
  const historyHasDistanceData = history.charts.some((c) => c.hasDistanceData);
  const showLineCharts =
    chartMode === "trip" ||
    (chartMode === "analytics" && historyRange === "day");
  const showBarCharts =
    chartMode === "analytics" && historyRange != null && historyRange !== "day" && (barCharts?.length ?? 0) > 0;

  const titleKey =
    chartMode === "trip" ? "vehicle.charts.title" : "vehicle.analytics.telemetryChartsTitle";

  const rangeSubtitle =
    chartMode === "analytics" && historyRange && anchorDate
      ? formatHistoryRangeSubtitle(historyRange, anchorDate, localeCode(locale))
      : null;

  const medianGapLabel =
    history.medianGapSeconds != null
      ? tx("vehicle.charts.medianGap", { value: history.medianGapSeconds.toFixed(1) })
      : null;

  const pointsLabel = tx("vehicle.charts.cloudPoints", { value: history.visiblePointCount });
  const subtitleParts = [
    rangeSubtitle,
    pointsLabel,
    medianGapLabel,
    history.start && history.end && showLineCharts
      ? `${new Date(history.start).toLocaleTimeString(localeCode(locale))} - ${new Date(history.end).toLocaleTimeString(localeCode(locale))}`
      : null,
  ].filter(Boolean);

  const subtitle = subtitleParts.join(" · ");

  return (
    <section className={embedded ? "rounded-2xl border border-border bg-white/[0.02] p-4" : "voltflow-card p-5"}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight">
            {tx(titleKey)}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <span className="rounded-full border border-border bg-white/[0.03] px-3 py-1 text-xs uppercase tracking-[0.18em] text-muted-foreground">
          {tx("vehicle.charts.refresh")}
        </span>
      </div>

      {isLoading ? (
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-52 rounded-2xl" />
          ))}
        </div>
      ) : hasError ? (
        <p className="mt-5 rounded-2xl border border-border bg-white/[0.03] p-4 text-sm text-muted-foreground">
          {tx("vehicle.errors.history")}
        </p>
      ) : history.visiblePointCount === 0 && !showBarCharts ? (
        <p className="mt-5 rounded-2xl border border-border bg-white/[0.03] p-4 text-sm text-muted-foreground">
          {tx("vehicle.charts.empty")}
        </p>
      ) : (
        <>
          {chartMode === "trip" && historyHasDistanceData && showLineCharts ? (
            <div className="mt-4 flex items-center gap-1.5">
              <button
                className={`rounded-full border px-3 py-1 text-xs font-medium transition ${tripXAxis === "time" ? "border-primary bg-primary/10 text-primary" : "border-border bg-white/[0.02] text-muted-foreground hover:border-primary/40 hover:text-foreground"}`}
                onClick={() => setTripXAxis("time")}
              >
                ⏱ {tx("vehicle.charts.elapsed")}
              </button>
              <button
                className={`rounded-full border px-3 py-1 text-xs font-medium transition ${tripXAxis === "distance" ? "border-primary bg-primary/10 text-primary" : "border-border bg-white/[0.02] text-muted-foreground hover:border-primary/40 hover:text-foreground"}`}
                onClick={() => setTripXAxis("distance")}
              >
                ↔ km
              </button>
            </div>
          ) : null}
          {showLineCharts && history.visiblePointCount > 0 && history.visiblePointCount < 2 ? (
            <p className="mt-5 rounded-2xl border border-primary/20 bg-primary/10 p-4 text-sm text-primary">
              {tx("vehicle.charts.onePoint")}
            </p>
          ) : null}
          {showLineCharts && history.visiblePointCount > 0 ? (
            <>
              {/* Base charts — always visible */}
              <div className="mt-5 grid gap-3 md:grid-cols-2">
                {history.charts
                  .filter((c) => c.tier === "base")
                  .map((chart) => (
                    <TelemetryLineChart
                      key={chart.title}
                      chart={chart}
                      lineGapMs={lineGapMs}
                      xAxis={chartMode === "trip" ? tripXAxis : "time"}
                    />
                  ))}
              </div>
              {/* Diagnostic charts — collapsed by default */}
              {(() => {
                const diagnosticCharts = history.charts.filter((c) => c.tier === "diagnostic" && c.hasData);
                const hasDiagnostic =
                  diagnosticCharts.length > 0 ||
                  history.regenRecoveryChart.hasData ||
                  history.deltaBySoc.points.length > 0;
                if (!hasDiagnostic) return null;
                return (
                  <details className="mt-3 group">
                    <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl border border-border bg-white/[0.02] px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground transition hover:border-primary/40 hover:text-foreground">
                      <span className="transition-transform group-open:rotate-90">›</span>
                      {tx("vehicle.charts.diagnosticsLabel")}
                    </summary>
                    <div className="mt-2 grid gap-3 md:grid-cols-2">
                      {diagnosticCharts.map((chart) => (
                        <TelemetryLineChart
                          key={chart.title}
                          chart={chart}
                          lineGapMs={lineGapMs}
                        />
                      ))}
                      {history.regenRecoveryChart.hasData ? (
                        <RegenRecoveryChart chart={history.regenRecoveryChart} />
                      ) : null}
                    </div>
                    {history.deltaBySoc.points.length > 0 ? (
                      <DeltaBySocChart chart={history.deltaBySoc} lineGapMs={lineGapMs} />
                    ) : null}
                  </details>
                );
              })()}
            </>
          ) : null}
          {showBarCharts ? (
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {barCharts!.map((chart) => (
                <TelemetryBarChart key={chart.title} chart={chart} />
              ))}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function seriesUnit(item: ChartSeries, chartUnit: string) {
  return item.unit ?? chartUnit;
}

function chartUsesDualAxis(series: ChartSeries[], chartUnit: string) {
  const units = series.map((item) => seriesUnit(item, chartUnit));
  return new Set(units).size > 1;
}

function buildSeriesScale(values: number[], valueDigits: number) {
  if (values.length === 0) {
    return {
      minValue: 0,
      maxValue: 1,
      y: () => 60,
      yTicks: [] as Array<{ label: string; value: number }>,
    };
  }

  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const valuePad = Math.max((maxValue - minValue) * 0.12, maxValue === minValue ? 1 : 0);
  const yMin = minValue - valuePad;
  const yMax = maxValue + valuePad;
  const y = (value: number) => {
    if (yMax === yMin) return 60;
    return 104 - ((value - yMin) / (yMax - yMin)) * 88;
  };
  const yTicks = [
    { label: fmt(maxValue, valueDigits), value: maxValue },
    { label: fmt((minValue + maxValue) / 2, valueDigits), value: (minValue + maxValue) / 2 },
    { label: fmt(minValue, valueDigits), value: minValue },
  ];

  return { minValue, maxValue, y, yTicks };
}

function formatChartRange(
  series: ChartSeries[],
  chartUnit: string,
  chartValueDigits: number,
  tx: Translator,
) {
  if (!series.length) return tx("vehicle.charts.noValues");

  return series
    .map((item) => {
      const values = item.points.map((point) => point.value);
      if (values.length === 0) return null;
      const digits = item.valueDigits ?? chartValueDigits;
      const unit = seriesUnit(item, chartUnit);
      const minValue = Math.min(...values);
      const maxValue = Math.max(...values);
      return `${fmt(minValue, digits)}-${fmt(maxValue, digits)}${unit ? ` ${unit}` : ""}`;
    })
    .filter(Boolean)
    .join(" · ");
}

function formatRegenRecoveryXLabel(xAxis: "distance" | "time", value: number) {
  if (xAxis === "distance") return `${fmt(value, 1)} km`;
  return formatClock(value);
}

function RegenRecoveryChart({ chart }: { chart: RegenRecoveryChartModel }) {
  const { t } = useTranslation();
  const tx = t as Translator;
  const [isOpen, setIsOpen] = useState(false);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const { title, unit, valueDigits, xAxis, segments, hasData } = chart;
  const regenColor = "#34d399";
  const totalRegen = segments.reduce((sum, segment) => sum + segment.regenKwh, 0);
  const maxRegen = segments.length ? Math.max(...segments.map((segment) => segment.regenKwh)) : 1;
  const minX = segments.length ? Math.min(...segments.map((segment) => segment.x)) : 0;
  const maxX = segments.length ? Math.max(...segments.map((segment) => segment.x)) : 1;
  const xPad =
    xAxis === "distance"
      ? Math.max((maxX - minX) * 0.04, 0.1)
      : Math.max((maxX - minX) * 0.04, 60_000);
  const plotMinX = minX - xPad;
  const plotMaxX = maxX + xPad;
  const yMin = 0;
  const yMax = Math.max(maxRegen * 1.12, 0.01);

  const xScale = (value: number) => {
    if (plotMaxX === plotMinX) return 160;
    return 34 + ((value - plotMinX) / (plotMaxX - plotMinX)) * 284;
  };
  const yScale = (value: number) => {
    if (yMax === yMin) return 104;
    return 104 - ((value - yMin) / (yMax - yMin)) * 88;
  };

  const xAxisLabel =
    xAxis === "distance"
      ? tx("vehicle.charts.regenAxisDistance" as TranslationKey)
      : tx("vehicle.charts.regenAxisTime" as TranslationKey);
  const rangeLabel = hasData
    ? `${fmt(totalRegen, valueDigits)} ${unit} ${tx("vehicle.charts.regenTotal" as TranslationKey)} · ${xAxisLabel}`
    : tx("vehicle.charts.noValues");

  const xTicks = hasData
    ? [
        { x: minX, label: formatRegenRecoveryXLabel(xAxis, minX) },
        { x: minX + (maxX - minX) / 2, label: formatRegenRecoveryXLabel(xAxis, minX + (maxX - minX) / 2) },
        { x: maxX, label: formatRegenRecoveryXLabel(xAxis, maxX) },
      ]
    : [];
  const yTicks = hasData
    ? [
        { label: fmt(yMax, valueDigits), value: yMax },
        { label: fmt(yMax / 2, valueDigits), value: yMax / 2 },
        { label: fmt(yMin, valueDigits), value: yMin },
      ]
    : [];
  const barWidth = segments.length
    ? Math.min(10, Math.max(3, (284 / Math.max(segments.length, 1)) * 0.7))
    : 4;
  const hoveredSegment = hoverIndex == null ? null : segments[hoverIndex] ?? null;

  const plot = (heightClass: string, interactive = false) => {
    const handleMouseMove = (event: React.MouseEvent<SVGSVGElement>) => {
      const pointer = clientToSvg(event.currentTarget, event.clientX, event.clientY, STD_CHART.width, STD_CHART.height);
      if (pointer.x < STD_CHART.plotLeft || pointer.x > STD_CHART.plotRight) {
        setHoverIndex(null);
        return;
      }
      const xPositions = segments.map((segment) => xScale(segment.x));
      setHoverIndex(nearestIndexByX(pointer.x, xPositions));
    };

    const svg = (
      <svg
        className={interactive ? "size-full overflow-visible" : `${heightClass} w-full overflow-visible`}
        viewBox="0 0 340 158"
        role="img"
        aria-label={tx("vehicle.charts.chartAria", { title })}
        onMouseMove={interactive ? handleMouseMove : undefined}
        onMouseLeave={interactive ? () => setHoverIndex(null) : undefined}
      >
      <line x1="34" x2="318" y1="104" y2="104" stroke="currentColor" className="text-border" strokeWidth="1" />
      <line x1="34" x2="34" y1="16" y2="104" stroke="currentColor" className="text-border" strokeWidth="1" />
      {yTicks.map((tick, index) => (
        <g key={`${title}-y-${index}`}>
          <line x1="34" x2="318" y1={yScale(tick.value)} y2={yScale(tick.value)} stroke="currentColor" className="text-border/60" strokeWidth="1" strokeDasharray="4 6" />
          <text x="29" y={yScale(tick.value) + 3} textAnchor="end" className="fill-muted-foreground text-[9px]">
            {tick.label}
          </text>
        </g>
      ))}
      {xTicks.map((tick, index) => (
        <g key={`${title}-x-${index}`}>
          <line x1={xScale(tick.x)} x2={xScale(tick.x)} y1="104" y2="109" stroke="currentColor" className="text-border" strokeWidth="1" />
          <text x={xScale(tick.x)} y="124" textAnchor="middle" className="fill-muted-foreground text-[9px]">
            {tick.label}
          </text>
        </g>
      ))}
      <text x="176" y="148" textAnchor="middle" className="fill-muted-foreground text-[9px]">
        {xAxisLabel}
      </text>
      <text x="6" y="60" textAnchor="middle" transform="rotate(-90 6 60)" className="fill-muted-foreground text-[9px]">
        {unit}
      </text>
      {segments.map((segment, index) => {
        const cx = xScale(segment.x);
        const baseline = yScale(yMin);
        const top = yScale(segment.regenKwh);
        const height = Math.max(0, baseline - top);
        const tooltip = `${formatRegenRecoveryXLabel(xAxis, segment.x)}\n${fmt(segment.regenKwh, valueDigits)} ${unit}`;
        const highlighted = interactive && hoverIndex === index;
        return (
          <g key={`${segment.x}-${index}`}>
            <rect
              x={cx - barWidth / 2}
              y={top}
              width={barWidth}
              height={height}
              rx="2"
              fill={regenColor}
              fillOpacity={highlighted ? 1 : 0.85}
              stroke={highlighted ? "#ffffff" : "none"}
              strokeWidth={highlighted ? 1.5 : 0}
            >
              {!interactive ? <title>{tooltip}</title> : null}
            </rect>
            {height >= 12 ? (
              <text x={cx} y={top - 3} textAnchor="middle" className="fill-foreground text-[7px] font-medium">
                {fmt(segment.regenKwh, valueDigits)}
              </text>
            ) : null}
          </g>
        );
      })}
      {interactive && hoveredSegment ? (
        <ChartHoverCrosshair
          snapX={xScale(hoveredSegment.x)}
          plotTop={STD_CHART.plotTop}
          plotBottom={STD_CHART.plotBottom}
        />
      ) : null}
      </svg>
    );

    return (
      <InteractiveChartShell
        heightClass={heightClass}
        interactive={interactive}
        tooltip={
          hoveredSegment ? (
            <ChartDataTooltip
              title={formatRegenRecoveryXLabel(xAxis, hoveredSegment.x)}
              rows={[{ label: tx("vehicle.trips.regen"), value: `${fmt(hoveredSegment.regenKwh, valueDigits)} ${unit}`, color: regenColor }]}
              viewBoxX={xScale(hoveredSegment.x)}
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
          <p className="mt-1 text-xs text-muted-foreground">{rangeLabel}</p>
        </div>
        <div className="flex shrink-0 items-center">
          <IconButton label={tx("vehicle.charts.fullscreen")} onClick={() => setIsOpen(true)}>
            <Maximize2 className="size-4" aria-hidden />
          </IconButton>
        </div>
      </div>

      <div className="mt-4">{plot("h-44")}</div>

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
            <p className="mt-1 text-xs text-muted-foreground">{rangeLabel}</p>
          </div>
          {plot("h-[60dvh]", true)}
        </DialogContent>
      </Dialog>
    </article>
  );
}

function TelemetryLineChart({
  chart,
  lineGapMs = CHART_LINE_GAP_MS,
  xAxis = "time",
}: {
  chart: TelemetryChart;
  lineGapMs?: number;
  xAxis?: "time" | "distance";
}) {
  const { t } = useTranslation();
  const tx = t as Translator;
  const [isOpen, setIsOpen] = useState(false);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const { title, unit, valueDigits, series, hasData, minValue, maxValue, minTime, maxTime, minDistanceKm, maxDistanceKm } = chart;
  // Fall back to time axis if no distance data available
  const activeXAxis = xAxis === "distance" && chart.hasDistanceData ? "distance" : "time";
  const dualAxis = chartUsesDualAxis(series, unit);
  const valuePad = Math.max((maxValue - minValue) * 0.12, maxValue === minValue ? 1 : 0);
  const yMin = minValue - valuePad;
  const yMax = maxValue + valuePad;
  const singleY = (value: number) => {
    if (yMax === yMin) return 60;
    return 104 - ((value - yMin) / (yMax - yMin)) * 88;
  };
  const seriesScales = series.map((item) =>
    buildSeriesScale(
      item.points.map((point) => point.value),
      item.valueDigits ?? valueDigits,
    ),
  );
  const rangeLabel = formatChartRange(series, unit, valueDigits, tx);
  const chartTimes = useMemo(
    () => [...new Set(series.flatMap((item) => item.points.map((point) => point.time)))].sort((a, b) => a - b),
    [series],
  );
  // Parallel distance array for chartTimes (used when activeXAxis === "distance")
  const chartTimeDistances = useMemo<(number | null)[] | null>(() => {
    if (activeXAxis !== "distance") return null;
    const map = new Map<number, number>();
    for (const item of series) {
      for (const point of item.points) {
        if (point.distanceKm != null) map.set(point.time, point.distanceKm);
      }
    }
    return chartTimes.map((t) => map.get(t) ?? null);
  }, [activeXAxis, series, chartTimes]);

  // X-axis: time mode uses point.time; distance mode uses point.distanceKm
  const x = (timeOrDist: number) => {
    if (activeXAxis === "distance") {
      if (maxDistanceKm === minDistanceKm) return 160;
      return 34 + ((timeOrDist - minDistanceKm) / (maxDistanceKm - minDistanceKm)) * 284;
    }
    if (maxTime === minTime) return 160;
    return 34 + ((timeOrDist - minTime) / (maxTime - minTime)) * 284;
  };
  const y = (seriesIndex: number, value: number) =>
    dualAxis ? seriesScales[seriesIndex].y(value) : singleY(value);
  const startTime = Number.isFinite(minTime) ? minTime : 0;
  // X-axis ticks: time labels or distance labels
  const xTicks = hasData
    ? activeXAxis === "distance"
      ? [
          { label: `${fmt(minDistanceKm, 1)} km`, xVal: minDistanceKm },
          { label: `${fmt((minDistanceKm + maxDistanceKm) / 2, 1)} km`, xVal: (minDistanceKm + maxDistanceKm) / 2 },
          { label: `${fmt(maxDistanceKm, 1)} km`, xVal: maxDistanceKm },
        ]
      : [
          { label: new Date(minTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), xVal: minTime },
          {
            label: new Date(minTime + (maxTime - minTime) / 2).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            xVal: minTime + (maxTime - minTime) / 2,
          },
          { label: new Date(maxTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), xVal: maxTime },
        ]
    : [];
  const xAxisLabel = activeXAxis === "distance" ? "km" : tx("vehicle.charts.elapsed");
  // Get SVG X coordinate for a chart point (uses distanceKm in distance mode)
  const xCoord = (point: ChartPoint) =>
    activeXAxis === "distance" && point.distanceKm != null ? x(point.distanceKm) : x(point.time);
  const singleYTicks = hasData
    ? [
        { label: fmt(maxValue, valueDigits), value: maxValue },
        { label: fmt((minValue + maxValue) / 2, valueDigits), value: (minValue + maxValue) / 2 },
        { label: fmt(minValue, valueDigits), value: minValue },
      ]
    : [];

  const pointTitle = (item: ChartSeries, point: ChartPoint) => {
    const elapsedMin = Math.max(0, Math.round((point.time - startTime) / 60000));
    const clock = new Date(point.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const digits = item.valueDigits ?? valueDigits;
    const pointUnit = seriesUnit(item, unit);
    const power = point.powerKw == null ? "" : `\n${tx("vehicle.metrics.power")}: ${fmt(point.powerKw, 1)} kW`;
    return `${item.label}: ${fmt(point.value, digits)}${pointUnit ? ` ${pointUnit}` : ""}\n${elapsedMin}m · ${clock}${power}`;
  };

  const hoverRows =
    hoverTime == null
      ? []
      : series
          .map((item, seriesIndex) => {
            const point = nearestPointByTime(item.points, hoverTime);
            if (!point) return null;
            const digits = item.valueDigits ?? valueDigits;
            const pointUnit = seriesUnit(item, unit);
            return {
              label: item.label,
              value: `${fmt(point.value, digits)}${pointUnit ? ` ${pointUnit}` : ""}`,
              color: item.color,
              y: y(seriesIndex, point.value),
            };
          })
          .filter((row): row is NonNullable<typeof row> => row != null);

  const plot = (heightClass: string, interactive = false) => {
    const handleMouseMove = (event: React.MouseEvent<SVGSVGElement>) => {
      const pointer = clientToSvg(event.currentTarget, event.clientX, event.clientY, STD_CHART.width, STD_CHART.height);
      if (pointer.x < STD_CHART.plotLeft || pointer.x > STD_CHART.plotRight || chartTimes.length === 0) {
        setHoverTime(null);
        return;
      }
      const xPositions = chartTimes.map((time, i) =>
        activeXAxis === "distance" && chartTimeDistances
          ? (chartTimeDistances[i] != null ? x(chartTimeDistances[i]!) : x(time))
          : x(time),
      );
      const index = nearestIndexByX(pointer.x, xPositions);
      setHoverTime(chartTimes[index] ?? null);
    };

    // Hover X position in SVG coords — distance mode uses mapped distanceKm
    const hoverX =
      hoverTime == null
        ? 0
        : activeXAxis === "distance"
          ? (() => {
              const idx = chartTimes.indexOf(hoverTime);
              const dist = idx >= 0 && chartTimeDistances ? (chartTimeDistances[idx] ?? null) : null;
              return dist != null ? x(dist) : x(hoverTime);
            })()
          : x(hoverTime);

    const svg = (
      <svg
        className={interactive ? "size-full overflow-visible" : `${heightClass} w-full overflow-visible`}
        viewBox="0 0 340 158"
        role="img"
        aria-label={tx("vehicle.charts.chartAria", { title })}
        onMouseMove={interactive ? handleMouseMove : undefined}
        onMouseLeave={interactive ? () => setHoverTime(null) : undefined}
      >
      <line x1="34" x2="318" y1="104" y2="104" stroke="currentColor" className="text-border" strokeWidth="1" />
      <line x1="34" x2="34" y1="16" y2="104" stroke="currentColor" className="text-border" strokeWidth="1" />
      {dualAxis ? <line x1="318" x2="318" y1="16" y2="104" stroke="currentColor" className="text-border" strokeWidth="1" /> : null}
      {dualAxis
        ? series.map((item, seriesIndex) =>
            seriesScales[seriesIndex].yTicks.map((tick, index) => (
              <g key={`${title}-y-${seriesIndex}-${index}`}>
                <line x1="34" x2="318" y1={y(seriesIndex, tick.value)} y2={y(seriesIndex, tick.value)} stroke="currentColor" className="text-border/40" strokeWidth="1" strokeDasharray="4 6" />
                {seriesIndex === 0 ? (
                  <text x="29" y={y(seriesIndex, tick.value) + 3} textAnchor="end" className="fill-muted-foreground text-[9px]">
                    {tick.label}
                  </text>
                ) : null}
                {seriesIndex === series.length - 1 ? (
                  <text x="323" y={y(seriesIndex, tick.value) + 3} textAnchor="start" className="fill-muted-foreground text-[9px]">
                    {tick.label}
                  </text>
                ) : null}
              </g>
            )),
          )
        : singleYTicks.map((tick, index) => (
            <g key={`${title}-y-${index}`}>
              <line x1="34" x2="318" y1={y(0, tick.value)} y2={y(0, tick.value)} stroke="currentColor" className="text-border/60" strokeWidth="1" strokeDasharray="4 6" />
              <text x="29" y={y(0, tick.value) + 3} textAnchor="end" className="fill-muted-foreground text-[9px]">
                {tick.label}
              </text>
            </g>
          ))}
      {xTicks.map((tick, index) => (
        <g key={`${title}-x-${index}`}>
          <line x1={x(tick.xVal)} x2={x(tick.xVal)} y1="104" y2="109" stroke="currentColor" className="text-border" strokeWidth="1" />
          <text x={x(tick.xVal)} y="124" textAnchor="middle" className="fill-muted-foreground text-[9px]">
            {tick.label}
          </text>
        </g>
      ))}
      <text x="176" y="148" textAnchor="middle" className="fill-muted-foreground text-[9px]">
        {xAxisLabel}
      </text>
      {dualAxis ? (
        <>
          <text x="6" y="60" textAnchor="middle" transform="rotate(-90 6 60)" className="fill-muted-foreground text-[9px]">
            {seriesUnit(series[0], unit)}
          </text>
          <text x="334" y="60" textAnchor="middle" transform="rotate(90 334 60)" className="fill-muted-foreground text-[9px]">
            {seriesUnit(series[series.length - 1], unit)}
          </text>
        </>
      ) : (
        <text x="6" y="60" textAnchor="middle" transform="rotate(-90 6 60)" className="fill-muted-foreground text-[9px]">
          {unit}
        </text>
      )}
      {series.map((item, seriesIndex) => {
        const pathSegments = buildBrokenLinePaths(
          item.points,
          (point) => ({
            x: xCoord(point),
            y: y(seriesIndex, point.value),
          }),
          lineGapMs,
        );
        const markers = item.points.length <= MAX_CHART_MARKERS ? item.points : [];
        return (
          <g key={item.label}>
            {pathSegments.map((d, pathIndex) => (
              <path
                key={`${item.label}-path-${pathIndex}`}
                d={d}
                fill="none"
                stroke={item.color}
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
            {item.points.map((point, index) => (
              <circle
                key={`${item.label}-hit-${point.time}-${index}`}
                cx={xCoord(point)}
                cy={y(seriesIndex, point.value)}
                r="7"
                fill="transparent"
              >
                {!interactive ? <title>{pointTitle(item, point)}</title> : null}
              </circle>
            ))}
            {markers.map((point, index) => (
              <circle key={`${item.label}-${point.time}-${index}`} cx={xCoord(point)} cy={y(seriesIndex, point.value)} r="3.5" fill={item.color}>
                {!interactive ? <title>{pointTitle(item, point)}</title> : null}
              </circle>
            ))}
            {interactive && hoverTime != null
              ? (() => {
                  const point = nearestPointByTime(item.points, hoverTime);
                  if (!point) return null;
                  return (
                    <circle
                      cx={xCoord(point)}
                      cy={y(seriesIndex, point.value)}
                      r="5"
                      fill="#ffffff"
                      stroke={item.color}
                      strokeWidth="2"
                      pointerEvents="none"
                    />
                  );
                })()
              : null}
          </g>
        );
      })}
      {interactive && hoverTime != null ? (
        <ChartHoverCrosshair snapX={hoverX} plotTop={STD_CHART.plotTop} plotBottom={STD_CHART.plotBottom} />
      ) : null}
      </svg>
    );

    return (
      <InteractiveChartShell
        heightClass={heightClass}
        interactive={interactive}
        tooltip={
          interactive && hoverTime != null && hoverRows.length > 0 ? (
            <ChartDataTooltip
              title={formatClock(hoverTime)}
              rows={hoverRows.map(({ label, value, color }) => ({ label, value, color }))}
              viewBoxX={hoverX}
              viewBoxY={Math.min(...hoverRows.map((row) => row.y)) - 8}
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
        </div>
        <div className="flex shrink-0 items-center">
          <IconButton label={tx("vehicle.charts.fullscreen")} onClick={() => setIsOpen(true)}>
            <Maximize2 className="size-4" aria-hidden />
          </IconButton>
        </div>
      </div>

      <div className="mt-4">{plot("h-44")}</div>

      <Dialog
        open={isOpen}
        onOpenChange={(open) => {
          setIsOpen(open);
          if (!open) setHoverTime(null);
        }}
      >
        <DialogContent className="h-[calc(100dvh-1rem)] max-w-[calc(100vw-1rem)] gap-3 p-3 sm:max-w-[calc(100vw-2rem)]">
          <DialogTitle className="sr-only">{title}</DialogTitle>
          <div className="px-1">
            <h3 className="font-heading text-xl font-semibold tracking-tight">{title}</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {hasData ? rangeLabel : tx("vehicle.charts.noValues")}
            </p>
          </div>
          {plot("h-[60dvh]", true)}
          <div className="px-1 pt-1">
            <ChartSeriesLegend series={series} />
          </div>
        </DialogContent>
      </Dialog>
    </article>
  );
}

function DeltaBySocChart({
  chart,
  lineGapMs = CHART_LINE_GAP_MS,
}: {
  chart: DeltaBySocChartModel;
  lineGapMs?: number;
}) {
  const { t } = useTranslation();
  const tx = t as Translator;
  const [isOpen, setIsOpen] = useState(false);
  const [zoom, setZoom] = useState(0);
  const { points, latest } = chart;

  if (points.length === 0) {
    return null;
  }

  const zoomOut = () => setZoom((value) => Math.max(0, value - 1));
  const zoomIn = () => setZoom((value) => Math.min(5, value + 1));
  const resetZoom = () => setZoom(0);
  const zoomFactor = 1 + zoom * 0.45;

  return (
    <article className="mt-3 rounded-2xl border border-border bg-white/[0.02] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-heading text-lg font-semibold tracking-tight">
            {tx("vehicle.charts.deltaBySoc")}
          </h3>
          <p className="mt-1 max-w-[22rem] text-xs leading-5 text-muted-foreground">
            {tx("vehicle.charts.deltaBySocSubtitle", { value: points.length })}
          </p>
        </div>
        <IconButton label={tx("vehicle.charts.fullscreen")} onClick={() => setIsOpen(true)}>
          <Maximize2 className="size-4" aria-hidden />
        </IconButton>
      </div>

      <div className="mt-4">
        <DeltaBySocPlot chart={chart} zoom={0} heightClassName="h-44" lineGapMs={lineGapMs} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <DeltaBySocStat compact label={tx("vehicle.charts.points")} value={points.length.toString()} />
        <DeltaBySocStat compact label={tx("vehicle.charts.socRange")} value={`${fmt(chart.minSoc, 0)}-${fmt(chart.maxSoc, 0)}%`} />
        <DeltaBySocStat compact label={tx("vehicle.charts.deltaRange")} value={`${fmt(chart.minDelta, 3)}-${fmt(chart.maxDelta, 3)} V`} />
        <DeltaBySocStat
          compact
          label={tx("vehicle.charts.latestPoint")}
          value={latest ? `${fmt(latest.soc, 0)}% / ${fmt(latest.delta, 3)} V` : "—"}
        />
      </div>

      <Dialog
        open={isOpen}
        onOpenChange={(open) => {
          setIsOpen(open);
        }}
      >
        <DialogContent className="h-[calc(100dvh-1rem)] max-w-[calc(100vw-1rem)] gap-3 p-3 sm:max-w-[calc(100vw-2rem)]">
          <DialogTitle className="sr-only">{tx("vehicle.charts.deltaBySoc")}</DialogTitle>
          <div className="flex flex-wrap items-start justify-between gap-3 px-1">
            <div>
              <h3 className="font-heading text-xl font-semibold tracking-tight">
                {tx("vehicle.charts.deltaBySoc")}
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {tx("vehicle.charts.deltaBySocSubtitle", { value: points.length })}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <IconButton
                label={tx("vehicle.charts.zoomOut")}
                onClick={zoomOut}
                disabled={zoom === 0}
              >
                <Minus className="size-4" aria-hidden />
              </IconButton>
              <button
                type="button"
                onClick={resetZoom}
                className="h-9 rounded-full border border-border bg-white/[0.03] px-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground transition hover:border-primary/50 hover:text-foreground disabled:opacity-45"
                disabled={zoom === 0}
                title={tx("vehicle.charts.resetZoom")}
              >
                {zoom === 0 ? "1x" : `${fmt(zoomFactor, 1)}x`}
              </button>
              <IconButton
                label={tx("vehicle.charts.zoomIn")}
                onClick={zoomIn}
                disabled={zoom === 5}
              >
                <Plus className="size-4" aria-hidden />
              </IconButton>
            </div>
          </div>
          <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[1fr_15rem]">
            <DeltaBySocPlot
              chart={chart}
              zoom={zoom}
              heightClassName="h-full min-h-[22rem]"
              interactive
              lineGapMs={lineGapMs}
            />
            <div className="grid content-start gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <DeltaBySocStat label={tx("vehicle.charts.points")} value={points.length.toString()} />
              <DeltaBySocStat label={tx("vehicle.charts.socRange")} value={`${fmt(chart.minSoc, 0)}-${fmt(chart.maxSoc, 0)}%`} />
              <DeltaBySocStat label={tx("vehicle.charts.deltaRange")} value={`${fmt(chart.minDelta, 3)}-${fmt(chart.maxDelta, 3)} V`} />
              <DeltaBySocStat
                label={tx("vehicle.charts.latestPoint")}
                value={latest ? `${fmt(latest.soc, 0)}% / ${fmt(latest.delta, 3)} V` : "—"}
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </article>
  );
}

function DeltaBySocPlot({
  chart,
  heightClassName,
  interactive = false,
  lineGapMs = CHART_LINE_GAP_MS,
}: {
  chart: DeltaBySocChartModel;
  zoom?: number;
  heightClassName: string;
  interactive?: boolean;
  lineGapMs?: number;
}) {
  const { t } = useTranslation();
  const tx = t as Translator;
  const clipId = useId();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const { points, latest } = chart;
  const visibleMinDelta = Math.min(...points.map((point) => point.delta));
  const visibleMaxDelta = Math.max(...points.map((point) => point.delta));
  const minSoc = Math.min(...points.map((point) => point.soc));
  const maxSoc = Math.max(...points.map((point) => point.soc));
  const minTime = Math.min(...points.map((point) => point.time));
  const maxTime = Math.max(...points.map((point) => point.time));
  const deltaPad = Math.max((visibleMaxDelta - visibleMinDelta) * 0.14, 0.005);
  const yMin = Math.max(0, visibleMinDelta - deltaPad);
  const yMax = visibleMaxDelta + deltaPad;
  const effectiveLineGapMs = deltaBySocTripLineGapMs(points, lineGapMs);

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
  const linePaths = buildBrokenLinePaths(
    points,
    (point) => ({
      x: x(point.time),
      y: y(point.delta),
    }),
    effectiveLineGapMs,
  );
  const socPaths = buildBrokenLinePaths(
    points,
    (point) => ({
      x: x(point.time),
      y: socY(point.soc),
    }),
    effectiveLineGapMs,
  );
  const markerPoints =
    points.length <= MAX_CHART_MARKERS ? points : latest ? [latest] : [];
  const hoveredPoint = hoverIndex == null ? null : points[hoverIndex] ?? null;

  const handleMouseMove = (event: React.MouseEvent<SVGSVGElement>) => {
    const pointer = clientToSvg(
      event.currentTarget,
      event.clientX,
      event.clientY,
      DELTA_SOC_CHART.width,
      DELTA_SOC_CHART.height,
    );
    if (pointer.x < DELTA_SOC_CHART.plotLeft || pointer.x > DELTA_SOC_CHART.plotRight || points.length === 0) {
      setHoverIndex(null);
      return;
    }
    const xPositions = points.map((point) => x(point.time));
    setHoverIndex(nearestIndexByX(pointer.x, xPositions));
  };

  const svg = (
    <svg
      className={interactive ? "size-full overflow-hidden" : `${heightClassName} w-full overflow-hidden`}
      viewBox="0 0 320 142"
      role="img"
      aria-label={tx("vehicle.charts.deltaBySoc")}
      onMouseMove={interactive ? handleMouseMove : undefined}
      onMouseLeave={interactive ? () => setHoverIndex(null) : undefined}
    >
        <defs>
          <clipPath id={clipId}>
            <rect x="24" y="18" width="272" height="92" />
          </clipPath>
        </defs>
        <line x1="24" x2="296" y1="110" y2="110" stroke="currentColor" className="text-border" strokeWidth="1" />
        <line x1="24" x2="24" y1="18" y2="110" stroke="currentColor" className="text-border" strokeWidth="1" />
        <line x1="24" x2="296" y1="64" y2="64" stroke="currentColor" className="text-border/70" strokeWidth="1" strokeDasharray="4 6" />
        <text x="24" y="132" className="fill-muted-foreground text-[10px]">
          {formatClock(minTime)}
        </text>
        <text x="296" y="132" textAnchor="end" className="fill-muted-foreground text-[10px]">
          {formatClock(maxTime)}
        </text>
        <text x="30" y="14" className="fill-muted-foreground text-[10px]">
          {fmt(yMax, 3)} V
        </text>
        <text x="30" y="106" className="fill-muted-foreground text-[10px]">
          {fmt(yMin, 3)} V
        </text>
        <text x="296" y="14" textAnchor="end" className="fill-primary text-[10px]">
          {fmt(maxSoc, 0)}% SOC
        </text>
        <text x="296" y="106" textAnchor="end" className="fill-primary text-[10px]">
          {fmt(minSoc, 0)}% SOC
        </text>
        <g clipPath={`url(#${clipId})`}>
          {socPaths.map((d, pathIndex) => (
            <path
              key={`soc-path-${pathIndex}`}
              d={d}
              fill="none"
              stroke="#22c55e"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.78"
              strokeDasharray="3 5"
            />
          ))}
          {linePaths.map((d, pathIndex) => (
            <path
              key={`delta-path-${pathIndex}`}
              d={d}
              fill="none"
              stroke="#38bdf8"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.78"
            />
          ))}
          {markerPoints.map((point, index) => {
            const isLatest = point === latest;
            const highlighted = interactive && hoveredPoint?.time === point.time;
            return (
              <circle
                key={`${point.time}-${index}`}
                cx={x(point.time)}
                cy={y(point.delta)}
                r={highlighted ? 4.5 : isLatest ? 4 : 3}
                fill={highlighted ? "#ffffff" : isLatest ? "#facc15" : "#fb7185"}
                stroke={highlighted ? "#38bdf8" : "none"}
                strokeWidth={highlighted ? 2 : 0}
                opacity={isLatest || highlighted ? 1 : 0.78}
              />
            );
          })}
        </g>
        {interactive && hoveredPoint ? (
          <ChartHoverCrosshair
            snapX={x(hoveredPoint.time)}
            plotTop={DELTA_SOC_CHART.plotTop}
            plotBottom={DELTA_SOC_CHART.plotBottom}
          />
        ) : null}
      </svg>
  );

  return (
    <div className="rounded-2xl border border-border bg-background/30 p-3">
      <InteractiveChartShell
        heightClass={heightClassName}
        interactive={interactive}
        tooltip={
          interactive && hoveredPoint ? (
            <ChartDataTooltip
              title={formatClock(hoveredPoint.time)}
              rows={[
                { label: tx("vehicle.charts.soc"), value: `${fmt(hoveredPoint.soc, 0)}%`, color: "#22c55e" },
                { label: tx("vehicle.charts.cellDelta"), value: `${fmt(hoveredPoint.delta, 3)} V`, color: "#38bdf8" },
              ]}
              viewBoxX={x(hoveredPoint.time)}
              viewBoxY={y(hoveredPoint.delta)}
              viewBoxWidth={DELTA_SOC_CHART.width}
              viewBoxHeight={DELTA_SOC_CHART.height}
              placement="auto"
            />
          ) : null
        }
      >
        {svg}
      </InteractiveChartShell>
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
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="grid size-9 place-items-center rounded-full border border-border bg-white/[0.03] text-muted-foreground transition hover:border-primary/50 hover:text-foreground disabled:opacity-45"
      title={label}
      aria-label={label}
    >
      {children}
    </button>
  );
}

function DeltaBySocStat({ label, value, compact = false }: { label: string; value: string; compact?: boolean }) {
  return (
    <div className={`rounded-2xl border border-border bg-background/30 ${compact ? "p-3" : "p-3"}`}>
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-2 font-mono text-sm text-foreground">{value}</p>
    </div>
  );
}

function prepareRouteFromTrack(points: BydmateTripTrackPointRow[]) {
  const routePoints: RoutePoint[] = [];
  let minLat = 0;
  let maxLat = 1;
  let minLon = 0;
  let maxLon = 1;

  for (const point of points) {
    const lat = validNumber(point.lat);
    const lon = validNumber(point.lon);
    const time = Date.parse(point.device_time);
    if (lat == null || lon == null || !Number.isFinite(time)) continue;

    routePoints.push({
      lat,
      lon,
      time,
      powerKw: validNumber(point.power_kw),
      speedKmh: validNumber(point.speed_kmh),
      soc: validNumber(point.soc),
    });
    if (routePoints.length === 1) {
      minLat = lat;
      maxLat = lat;
      minLon = lon;
      maxLon = lon;
    } else {
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
    }
  }

  return {
    points: downsamplePoints(routePoints, MAX_ROUTE_POINTS),
    totalPoints: routePoints.length,
    start: routePoints[0],
    end: routePoints.at(-1),
    minLat,
    maxLat,
    minLon,
    maxLon,
  };
}

function prepareRoute(points: BydmateTelemetryPointRow[]) {
  const routePoints: RoutePoint[] = [];
  let minLat = 0;
  let maxLat = 1;
  let minLon = 0;
  let maxLon = 1;

  for (const point of points) {
    const lat = validNumber(point.location?.lat);
    const lon = validNumber(point.location?.lon);
    const time = pointTimeMs(point);
    if (lat == null || lon == null || !Number.isFinite(time)) continue;

    routePoints.push({
      lat,
      lon,
      time,
      powerKw: validNumber(point.telemetry.power_kw),
      speedKmh: validNumber(point.telemetry.speed_kmh),
      soc: validNumber(point.telemetry.soc),
    });
    if (routePoints.length === 1) {
      minLat = lat;
      maxLat = lat;
      minLon = lon;
      maxLon = lon;
    } else {
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
    }
  }

  return {
    points: downsamplePoints(routePoints, MAX_ROUTE_POINTS),
    totalPoints: routePoints.length,
    start: routePoints[0],
    end: routePoints.at(-1),
    minLat,
    maxLat,
    minLon,
    maxLon,
  };
}

function prepareLiveLocationRoute(
  location: BydmateLocation,
  deviceTimeMs: number,
  telemetry: BydmateLiveSnapshotRow["telemetry"],
): ReturnType<typeof prepareRoute> {
  const lat = validNumber(location.lat);
  const lon = validNumber(location.lon);
  if (lat == null || lon == null || !Number.isFinite(deviceTimeMs)) {
    return prepareRoute([]);
  }

  const point: RoutePoint = {
    lat,
    lon,
    time: deviceTimeMs,
    powerKw: validNumber(telemetry.power_kw),
    speedKmh: validNumber(telemetry.speed_kmh),
    soc: validNumber(telemetry.soc),
  };

  return {
    points: [point],
    totalPoints: 1,
    start: point,
    end: point,
    minLat: lat,
    maxLat: lat,
    minLon: lon,
    maxLon: lon,
  };
}

function clampLatitude(value: number) {
  return Math.min(WEB_MERCATOR_MAX_LAT, Math.max(-WEB_MERCATOR_MAX_LAT, value));
}

function projectMercator(lat: number, lon: number, zoom: number) {
  const scale = MAP_TILE_SIZE * 2 ** zoom;
  const clampedLat = clampLatitude(lat);
  const sinLat = Math.sin((clampedLat * Math.PI) / 180);

  return {
    x: ((lon + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale,
  };
}

function routeBoundsAtZoom(route: ReturnType<typeof prepareRoute>, zoom: number) {
  const topLeft = projectMercator(route.maxLat, route.minLon, zoom);
  const bottomRight = projectMercator(route.minLat, route.maxLon, zoom);

  return {
    minX: topLeft.x,
    maxX: bottomRight.x,
    minY: topLeft.y,
    maxY: bottomRight.y,
    width: Math.max(1, bottomRight.x - topLeft.x),
    height: Math.max(1, bottomRight.y - topLeft.y),
  };
}

function chooseRouteZoom(route: ReturnType<typeof prepareRoute>) {
  if (!route.start || !route.end || route.totalPoints < 2) return DEFAULT_MAP_ZOOM;

  for (let zoom = MAX_MAP_ZOOM; zoom >= MIN_MAP_ZOOM; zoom -= 1) {
    const bounds = routeBoundsAtZoom(route, zoom);
    if (bounds.width <= ROUTE_MAP_INNER_WIDTH && bounds.height <= ROUTE_MAP_INNER_HEIGHT) {
      return zoom;
    }
  }

  return MIN_MAP_ZOOM;
}

function stepRouteMapZoom(baseZoom: number, zoomOffset: number, pan: MapPan, delta: number) {
  const minOffset = MIN_MAP_ZOOM - baseZoom;
  const maxOffset = MAX_MAP_ZOOM - baseZoom;
  const nextOffset = Math.max(minOffset, Math.min(maxOffset, zoomOffset + delta));
  if (nextOffset === zoomOffset) {
    return { zoomOffset, pan };
  }

  const scale = 2 ** (nextOffset - zoomOffset);
  return {
    zoomOffset: nextOffset,
    pan: { x: pan.x * scale, y: pan.y * scale },
  };
}

function prepareRouteMap(route: ReturnType<typeof prepareRoute>, zoomOffset: number, pan: MapPan) {
  const zoom = Math.max(
    MIN_MAP_ZOOM,
    Math.min(MAX_MAP_ZOOM, chooseRouteZoom(route) + zoomOffset),
  );
  const bounds = routeBoundsAtZoom(route, zoom);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const topLeftX = centerX - MAP_VIEW_WIDTH / 2 - pan.x;
  const topLeftY = centerY - MAP_VIEW_HEIGHT / 2 - pan.y;
  const minTileX = Math.floor(topLeftX / MAP_TILE_SIZE);
  const maxTileX = Math.floor((topLeftX + MAP_VIEW_WIDTH) / MAP_TILE_SIZE);
  const minTileY = Math.floor(topLeftY / MAP_TILE_SIZE);
  const maxTileY = Math.floor((topLeftY + MAP_VIEW_HEIGHT) / MAP_TILE_SIZE);
  const tileCount = 2 ** zoom;
  const tiles: MapTile[] = [];

  for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
    if (tileY < 0 || tileY >= tileCount) continue;

    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
      const wrappedTileX = ((tileX % tileCount) + tileCount) % tileCount;
      tiles.push({
        key: `${zoom}-${wrappedTileX}-${tileY}-${tileX}`,
        url: `https://tile.openstreetmap.org/${zoom}/${wrappedTileX}/${tileY}.png`,
        x: tileX * MAP_TILE_SIZE - topLeftX,
        y: tileY * MAP_TILE_SIZE - topLeftY,
      });
    }
  }

  const mapPoint = (point: RoutePoint) => {
    const projected = projectMercator(point.lat, point.lon, zoom);
    return {
      x: projected.x - topLeftX,
      y: projected.y - topLeftY,
    };
  };

  return {
    zoom,
    tiles,
    mapPoint,
  };
}

function routeLayerValue(point: RoutePoint, layer: RouteLayer) {
  if (layer === "power") return point.powerKw == null ? null : Math.abs(point.powerKw);
  if (layer === "speed") return point.speedKmh;
  if (layer === "soc") return point.soc;
  return null;
}

function routeLayerColor(layer: RouteLayer) {
  return ROUTE_LAYER_OPTIONS.find((option) => option.id === layer)?.color ?? "var(--voltflow-cyan)";
}

function routeLayerSegmentColor(layer: RouteLayer | "regen", normalized: number) {
  const intensity = Math.max(0, Math.min(1, normalized));

  if (layer === "power") {
    return `hsl(0 84% ${38 + intensity * 24}%)`;
  }

  if (layer === "regen") {
    return `hsl(158 72% ${34 + intensity * 28}%)`;
  }

  if (layer === "speed") {
    return `hsl(142 72% ${34 + intensity * 26}%)`;
  }

  if (layer === "soc") {
    return `hsl(48 96% ${32 + intensity * 30}%)`;
  }

  return routeLayerColor(layer);
}

function layerDisplayRange(layer: RouteLayer, minValue: number, maxValue: number) {
  if (layer === "soc") return { min: 0, max: 100 };
  if (layer === "speed") return { min: 0, max: Math.max(120, maxValue) };
  if (layer === "power") return { min: 0, max: Math.max(50, maxValue) };
  return { min: minValue, max: maxValue };
}

function powerScaleBounds(points: RoutePoint[]) {
  let maxTraction = 5;
  let maxRegen = 5;

  for (const point of points) {
    const powerKw = point.powerKw;
    if (powerKw == null) continue;
    if (powerKw > REGEN_POWER_THRESHOLD_KW) {
      maxTraction = Math.max(maxTraction, powerKw);
    }
    if (powerKw < -REGEN_POWER_THRESHOLD_KW) {
      maxRegen = Math.max(maxRegen, -powerKw);
    }
  }

  return {
    maxTraction: Math.max(50, maxTraction),
    maxRegen: Math.max(20, maxRegen),
  };
}

function combinedPowerColor(
  powerKw: number | null | undefined,
  maxTraction: number,
  maxRegen: number,
) {
  if (powerKw == null) return COAST_POWER_COLOR;
  if (powerKw < -REGEN_POWER_THRESHOLD_KW) {
    return routeLayerSegmentColor("regen", Math.min(1, (-powerKw) / maxRegen));
  }
  if (powerKw > REGEN_POWER_THRESHOLD_KW) {
    return routeLayerSegmentColor("power", Math.min(1, powerKw / maxTraction));
  }
  return COAST_POWER_COLOR;
}

function normalizeForLayer(
  layer: RouteLayer,
  value: number | null,
  minValue: number,
  maxValue: number,
) {
  if (value == null) return 0;
  const range = layerDisplayRange(layer, minValue, maxValue);
  if (range.max <= range.min) return 1;
  return Math.max(0, Math.min(1, (value - range.min) / (range.max - range.min)));
}

function dedupeGradientStops(stops: Array<{ offset: number; color: string }>) {
  const sorted = [...stops].sort((a, b) => a.offset - b.offset);
  const deduped: Array<{ offset: number; color: string }> = [];

  for (const stop of sorted) {
    const last = deduped.at(-1);
    if (last && Math.abs(last.offset - stop.offset) < 0.001) {
      last.color = stop.color;
      continue;
    }
    deduped.push({ ...stop });
  }

  if (deduped.length === 0) return [{ offset: 0, color: routeLayerSegmentColor("power", 0) }];
  if (deduped[0].offset > 0) deduped.unshift({ offset: 0, color: deduped[0].color });
  const last = deduped.at(-1)!;
  if (last.offset < 1) deduped.push({ offset: 1, color: last.color });

  return deduped;
}

function buildPathFromMappedPoints(mappedPoints: Array<{ x: number; y: number }>) {
  if (mappedPoints.length < 2) return "";
  const [first, ...rest] = mappedPoints;
  let path = `M ${first.x.toFixed(2)} ${first.y.toFixed(2)}`;
  for (const point of rest) {
    path += ` L ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
  }
  return path;
}

type GradientRouteStroke = {
  key: string;
  d: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
  stops: Array<{ offset: number; color: string }>;
};

function buildGradientRouteStroke(
  points: RoutePoint[],
  routeMap: ReturnType<typeof prepareRouteMap>,
  key: string,
  colorAtPoint: (point: RoutePoint) => string,
): GradientRouteStroke | null {
  if (points.length < 2) return null;

  const mappedPoints = points.map((point) => routeMap.mapPoint(point));
  const d = buildPathFromMappedPoints(mappedPoints);
  const start = mappedPoints[0];
  const end = mappedPoints[mappedPoints.length - 1];

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = dx * dx + dy * dy || 1;

  const stops = dedupeGradientStops(
    points.map((point) => {
      const mapped = routeMap.mapPoint(point);
      const projection = ((mapped.x - start.x) * dx + (mapped.y - start.y) * dy) / lengthSq;
      const offset = Math.max(0, Math.min(1, projection));
      return {
        offset,
        color: colorAtPoint(point),
      };
    }),
  );

  return { key, d, start, end, stops };
}

function buildMetricGradientStroke(
  route: ReturnType<typeof prepareRoute>,
  routeMap: ReturnType<typeof prepareRouteMap>,
  layer: RouteLayer,
) {
  if (route.points.length < 2) return null;

  if (layer === "power") {
    const bounds = powerScaleBounds(route.points);
    return buildGradientRouteStroke(route.points, routeMap, layer, (point) =>
      combinedPowerColor(point.powerKw, bounds.maxTraction, bounds.maxRegen),
    );
  }

  const values = route.points
    .map((point) => routeLayerValue(point, layer))
    .filter((value): value is number => value != null);
  const minValue = values.length ? Math.min(...values) : 0;
  const maxValue = values.length ? Math.max(...values) : 1;

  return buildGradientRouteStroke(route.points, routeMap, layer, (point) => {
    const normalized = normalizeForLayer(layer, routeLayerValue(point, layer), minValue, maxValue);
    return routeLayerSegmentColor(layer, normalized);
  });
}

type MappedRoutePoint = { x: number; y: number };

function clientToRouteMapPoint(svg: SVGSVGElement, clientX: number, clientY: number) {
  const rect = svg.getBoundingClientRect();
  return {
    x: ((clientX - rect.left) / rect.width) * MAP_VIEW_WIDTH,
    y: ((clientY - rect.top) / rect.height) * MAP_VIEW_HEIGHT,
  };
}

function distanceSquared(ax: number, ay: number, bx: number, by: number) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function closestPointOnSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return { x: ax, y: ay, t: 0 };
  }

  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return {
    x: ax + t * dx,
    y: ay + t * dy,
    t,
  };
}

function findNearestRoutePoint(
  mappedPoints: MappedRoutePoint[],
  svgX: number,
  svgY: number,
  hitRadius = ROUTE_HIT_RADIUS,
) {
  const hitRadiusSquared = hitRadius * hitRadius;
  let bestDistanceSquared = hitRadiusSquared;
  let bestIndex = -1;
  let bestX = 0;
  let bestY = 0;

  for (let index = 0; index < mappedPoints.length - 1; index += 1) {
    const start = mappedPoints[index];
    const end = mappedPoints[index + 1];
    const closest = closestPointOnSegment(svgX, svgY, start.x, start.y, end.x, end.y);
    const distance = distanceSquared(svgX, svgY, closest.x, closest.y);
    if (distance >= bestDistanceSquared) continue;

    bestDistanceSquared = distance;
    bestIndex = closest.t <= 0.5 ? index : index + 1;
    bestX = closest.x;
    bestY = closest.y;
  }

  if (bestIndex < 0) return null;
  return { index: bestIndex, x: bestX, y: bestY };
}

function RoutePointTooltip({
  point,
  position,
  tx,
}: {
  point: RoutePoint;
  position: { x: number; y: number };
  tx: Translator;
}) {
  const left = (position.x / MAP_VIEW_WIDTH) * 100;
  const top = (position.y / MAP_VIEW_HEIGHT) * 100;

  return (
    <div
      className="pointer-events-none absolute z-20 min-w-[9rem] -translate-x-1/2 -translate-y-[calc(100%+0.5rem)] rounded-lg border border-border bg-background/95 px-2.5 py-1.5 text-[11px] shadow-lg backdrop-blur"
      style={{ left: `${left}%`, top: `${top}%` }}
    >
      <p className="font-semibold text-foreground">{formatClock(point.time)}</p>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-muted-foreground">
        <dt>{tx("vehicle.route.hoverSoc" as TranslationKey)}</dt>
        <dd className="text-right text-foreground">{fmt(point.soc, 0)}%</dd>
        <dt>{tx("vehicle.route.hoverSpeed" as TranslationKey)}</dt>
        <dd className="text-right text-foreground">{fmt(point.speedKmh, 0)} km/h</dd>
        <dt>{tx("vehicle.route.hoverPower" as TranslationKey)}</dt>
        <dd className="text-right text-foreground">{fmt(point.powerKw, 1)} kW</dd>
      </dl>
    </div>
  );
}

export function RouteMap({
  points,
  trackPoints,
  isLoading = false,
  hasError = false,
  embedded = false,
  headingMode = "route",
}: {
  points?: BydmateTelemetryPointRow[];
  trackPoints?: BydmateTripTrackPointRow[];
  isLoading?: boolean;
  hasError?: boolean;
  embedded?: boolean;
  /** Location card shows last-known position, not a trip route browser. */
  headingMode?: "route" | "lastSeen";
}) {
  const { t } = useTranslation();
  const tx = t as Translator;
  const route = useMemo(() => {
    if (trackPoints) return prepareRouteFromTrack(trackPoints);
    return prepareRoute(points ?? []);
  }, [points, trackPoints]);
  const start = route.start;
  const end = route.end;
  const baseZoom = useMemo(() => chooseRouteZoom(route), [route]);
  const [zoomOffset, setZoomOffset] = useState(0);
  const [pan, setPan] = useState<MapPan>({ x: 0, y: 0 });
  const panRef = useRef(pan);
  panRef.current = pan;
  const [isFullscreenOpen, setIsFullscreenOpen] = useState(false);
  const [selectedLayer, setSelectedLayer] = useState<RouteLayer>("route");

  const zoomBy = (delta: number) => {
    setZoomOffset((offset) => {
      const next = stepRouteMapZoom(baseZoom, offset, panRef.current, delta);
      if (next.zoomOffset !== offset) {
        setPan(next.pan);
      }
      return next.zoomOffset;
    });
  };
  const zoomIn = () => zoomBy(1);
  const zoomOut = () => zoomBy(-1);
  const resetView = () => {
    setZoomOffset(0);
    setPan({ x: 0, y: 0 });
  };
  const mapDialogTitleKey =
    headingMode === "lastSeen" ? ("vehicle.location.lastSeen" as TranslationKey) : ("vehicle.route.dialogTitle" as TranslationKey);

  return (
    <section className={embedded ? "rounded-2xl border border-border bg-white/[0.02] p-4" : "voltflow-card p-5"}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight">
            {tx(headingMode === "lastSeen" ? "vehicle.location.lastSeen" : "vehicle.route.title")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {tx(
              headingMode === "lastSeen"
                ? "vehicle.location.lastSeenPoints"
                : "vehicle.route.gpsPoints",
              { value: route.totalPoints },
            )}
          </p>
        </div>
        {start && end ? (
          <span className="rounded-full border border-border bg-white/[0.03] px-3 py-1 text-xs uppercase tracking-[0.18em] text-muted-foreground">
            {formatClock(start.time)} - {formatClock(end.time)}
          </span>
        ) : null}
      </div>

      {isLoading ? (
        <Skeleton className="mt-5 h-64 rounded-2xl" />
      ) : hasError ? (
        <p className="mt-5 rounded-2xl border border-border bg-white/[0.03] p-4 text-sm text-muted-foreground">
          {tx("vehicle.errors.history")}
        </p>
      ) : route.totalPoints === 0 ? (
        <p className="mt-5 rounded-2xl border border-border bg-white/[0.03] p-4 text-sm text-muted-foreground">
          {tx("vehicle.route.empty")}
        </p>
      ) : (
        <div className="mt-5 overflow-hidden rounded-2xl border border-border bg-background">
          <InteractiveRouteCanvas
            route={route}
            zoomOffset={zoomOffset}
            pan={pan}
            onPanChange={setPan}
            onZoomIn={zoomIn}
            onZoomOut={zoomOut}
            onResetView={resetView}
            onOpenFullscreen={() => setIsFullscreenOpen(true)}
            selectedLayer={selectedLayer}
            onLayerChange={setSelectedLayer}
            showLayerLegend={false}
            showToolbarControls={false}
            className="h-64"
          />
          <div className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
            {tx("vehicle.route.mapData")} &copy;{" "}
            <a
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              OpenStreetMap contributors
            </a>
          </div>
          <Dialog open={isFullscreenOpen} onOpenChange={setIsFullscreenOpen}>
            <DialogContent className="h-[calc(100dvh-1rem)] max-w-[calc(100vw-1rem)] gap-3 p-3 sm:max-w-[calc(100vw-2rem)]">
              <DialogTitle className="sr-only">{tx(mapDialogTitleKey)}</DialogTitle>
              <InteractiveRouteCanvas
                route={route}
                zoomOffset={zoomOffset}
                pan={pan}
                onPanChange={setPan}
                onZoomIn={zoomIn}
                onZoomOut={zoomOut}
                onResetView={resetView}
                selectedLayer={selectedLayer}
                onLayerChange={setSelectedLayer}
                onCloseFullscreen={() => setIsFullscreenOpen(false)}
                showLayerLegend
                className="min-h-0 flex-1 rounded-lg"
                isFullscreen
              />
              <div className="text-[11px] text-muted-foreground">
                {tx("vehicle.route.mapData")} &copy;{" "}
                <a
                  href="https://www.openstreetmap.org/copyright"
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2"
                >
                  OpenStreetMap contributors
                </a>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      )}
    </section>
  );
}

export function RouteMapPreview({
  trackPoints,
  odometerDistanceKm = null,
  className = "h-40",
}: {
  trackPoints: BydmateTripTrackPointRow[];
  odometerDistanceKm?: number | null;
  className?: string;
}) {
  const { t } = useTranslation();
  const tx = t as Translator;
  const route = useMemo(() => prepareRouteFromTrack(trackPoints), [trackPoints]);
  const baseZoom = useMemo(() => chooseRouteZoom(route), [route]);
  const [zoomOffset, setZoomOffset] = useState(0);
  const [pan, setPan] = useState<MapPan>({ x: 0, y: 0 });
  const panRef = useRef(pan);
  panRef.current = pan;
  const [selectedLayer, setSelectedLayer] = useState<RouteLayer>("route");
  const [isFullscreenOpen, setIsFullscreenOpen] = useState(false);
  const displayable = useMemo(
    () => isRouteTrackDisplayable(trackPoints, 2, 75, { odometerDistanceKm }),
    [trackPoints, odometerDistanceKm],
  );

  if (!displayable || route.totalPoints < 2) return null;

  const zoomBy = (delta: number) => {
    setZoomOffset((offset) => {
      const next = stepRouteMapZoom(baseZoom, offset, panRef.current, delta);
      if (next.zoomOffset !== offset) {
        setPan(next.pan);
      }
      return next.zoomOffset;
    });
  };
  const zoomIn = () => zoomBy(1);
  const zoomOut = () => zoomBy(-1);
  const resetView = () => {
    setZoomOffset(0);
    setPan({ x: 0, y: 0 });
  };

  const canvasProps = {
    route,
    zoomOffset,
    pan,
    onPanChange: setPan,
    onZoomIn: zoomIn,
    onZoomOut: zoomOut,
    onResetView: resetView,
    selectedLayer,
    onLayerChange: setSelectedLayer,
  };

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-border bg-background">
        <InteractiveRouteCanvas
          {...canvasProps}
          onOpenFullscreen={() => setIsFullscreenOpen(true)}
          showLayerLegend={false}
          showToolbarControls={false}
          className={className}
        />
      </div>
      <Dialog open={isFullscreenOpen} onOpenChange={setIsFullscreenOpen}>
        <DialogContent className="h-[calc(100dvh-1rem)] max-w-[calc(100vw-1rem)] gap-3 p-3 sm:max-w-[calc(100vw-2rem)]">
          <DialogTitle className="sr-only">{tx("vehicle.route.dialogTitle")}</DialogTitle>
          <InteractiveRouteCanvas
            {...canvasProps}
            onCloseFullscreen={() => setIsFullscreenOpen(false)}
            showLayerLegend
            className="min-h-0 flex-1 rounded-lg"
            isFullscreen
          />
          <div className="text-[11px] text-muted-foreground">
            {tx("vehicle.route.mapData")} &copy;{" "}
            <a
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              OpenStreetMap contributors
            </a>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function InteractiveRouteCanvas({
  route,
  zoomOffset,
  pan,
  onPanChange,
  onZoomIn,
  onZoomOut,
  onResetView,
  onOpenFullscreen,
  onCloseFullscreen,
  selectedLayer,
  onLayerChange,
  className = "h-64",
  isFullscreen = false,
  showLayerLegend = true,
  showToolbarControls = true,
  markerMode = "trip",
}: {
  route: ReturnType<typeof prepareRoute>;
  zoomOffset: number;
  pan: MapPan;
  onPanChange: (pan: MapPan | ((current: MapPan) => MapPan)) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetView: () => void;
  onOpenFullscreen?: () => void;
  onCloseFullscreen?: () => void;
  selectedLayer: RouteLayer;
  onLayerChange: (layer: RouteLayer) => void;
  className?: string;
  isFullscreen?: boolean;
  showLayerLegend?: boolean;
  showToolbarControls?: boolean;
  markerMode?: "trip" | "lastPoint";
}) {
  const { t } = useTranslation();
  const tx = t as Translator;
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const gradientId = useId().replace(/:/g, "");
  const [hoveredPoint, setHoveredPoint] = useState<{ index: number; x: number; y: number } | null>(null);
  const allowMapInteraction = isFullscreen || showToolbarControls;
  const routeMap = useMemo(() => prepareRouteMap(route, zoomOffset, pan), [pan, route, zoomOffset]);
  const mappedRoutePoints = useMemo(
    () => route.points.map((point) => routeMap.mapPoint(point)),
    [route.points, routeMap],
  );
  const solidRoutePath = useMemo(
    () => buildPathFromMappedPoints(mappedRoutePoints),
    [mappedRoutePoints],
  );
  const metricGradientStroke = useMemo(() => {
    if (selectedLayer === "power" || selectedLayer === "speed" || selectedLayer === "soc") {
      return buildMetricGradientStroke(route, routeMap, selectedLayer);
    }
    return null;
  }, [route, routeMap, selectedLayer]);
  const mappedStart = route.start ? routeMap.mapPoint(route.start) : null;
  const mappedEnd = route.end ? routeMap.mapPoint(route.end) : null;
  const activeRoutePoint = hoveredPoint ? route.points[hoveredPoint.index] ?? null : null;

  const updateRouteHover = (clientX: number, clientY: number, element: SVGSVGElement) => {
    if (dragRef.current) return;

    const pointer = clientToRouteMapPoint(element, clientX, clientY);
    const nearest = findNearestRoutePoint(mappedRoutePoints, pointer.x, pointer.y);
    setHoveredPoint((current) => {
      if (!nearest) return current ? null : current;
      if (
        current &&
        current.index === nearest.index &&
        current.x === nearest.x &&
        current.y === nearest.y
      ) {
        return current;
      }
      return nearest;
    });
  };

  const dragMap = (clientX: number, clientY: number, element: SVGSVGElement) => {
    const previous = dragRef.current;
    if (!previous) return;

    const rect = element.getBoundingClientRect();
    const deltaX = ((clientX - previous.x) * MAP_VIEW_WIDTH) / rect.width;
    const deltaY = ((clientY - previous.y) * MAP_VIEW_HEIGHT) / rect.height;
    onPanChange((current) => ({ x: current.x + deltaX, y: current.y + deltaY }));
    dragRef.current = { x: clientX, y: clientY };
  };

  return (
    <div className={`relative overflow-hidden bg-background ${className}`}>
      {showLayerLegend ? (
        <div className="absolute left-2 top-2 z-10 grid w-[10rem] grid-cols-2 gap-1 rounded-2xl border border-border bg-background/85 p-1 shadow-sm backdrop-blur sm:left-3 sm:top-3 sm:w-auto sm:grid-cols-4 sm:rounded-full">
          {ROUTE_LAYER_OPTIONS.map((option) => {
            const selected = option.id === selectedLayer;
            const label = tx(`vehicle.route.layers.${option.id}` as TranslationKey);
            const shortLabel = tx(`vehicle.route.layerShort.${option.id}` as TranslationKey);

            return (
              <button
                key={option.id}
                type="button"
                onClick={() => onLayerChange(option.id)}
                className={
                  "inline-flex h-7 min-w-0 items-center justify-center gap-1 rounded-full px-2 text-[10px] font-semibold uppercase tracking-normal transition sm:h-8 sm:px-2.5 sm:text-[11px] " +
                  (selected
                    ? "bg-primary/15 text-foreground"
                    : "text-muted-foreground hover:bg-white/10 hover:text-foreground")
                }
                aria-pressed={selected}
                aria-label={label}
                title={label}
              >
                {option.id === "power" ? (
                  <span className="flex shrink-0 items-center gap-0.5" aria-hidden>
                    <span className="size-1.5 rounded-full bg-red-500 sm:size-2" />
                    <span className="size-1.5 rounded-full bg-emerald-400 sm:size-2" />
                  </span>
                ) : (
                  <span
                    className="size-1.5 shrink-0 rounded-full sm:size-2"
                    style={{ backgroundColor: option.color }}
                    aria-hidden
                  />
                )}
                <span className="truncate">{shortLabel}</span>
              </button>
            );
          })}
        </div>
      ) : null}
      <div className="absolute right-2 top-2 z-10 flex gap-1.5 sm:right-3 sm:top-3 sm:gap-2">
        {showToolbarControls ? (
          <>
            <MapIconButton label={tx("vehicle.route.zoomIn")} onClick={onZoomIn}>
              <Plus className="size-4" aria-hidden />
            </MapIconButton>
            <MapIconButton label={tx("vehicle.route.zoomOut")} onClick={onZoomOut}>
              <Minus className="size-4" aria-hidden />
            </MapIconButton>
            <MapIconButton label={tx("vehicle.route.resetMap")} onClick={onResetView}>
              <MapPin className="size-4" aria-hidden />
            </MapIconButton>
          </>
        ) : null}
        {!isFullscreen && onOpenFullscreen ? (
          <MapIconButton label={tx("vehicle.route.fullscreen")} onClick={onOpenFullscreen}>
            <Maximize2 className="size-4" aria-hidden />
          </MapIconButton>
        ) : null}
        {isFullscreen && onCloseFullscreen ? (
          <MapIconButton label={tx("vehicle.route.exitFullscreen")} onClick={onCloseFullscreen}>
            <Minimize2 className="size-4" aria-hidden />
          </MapIconButton>
        ) : null}
      </div>
      {activeRoutePoint && hoveredPoint ? (
        <RoutePointTooltip point={activeRoutePoint} position={hoveredPoint} tx={tx} />
      ) : null}
      <svg
        className={`size-full touch-none ${allowMapInteraction ? "cursor-grab active:cursor-grabbing" : hoveredPoint ? "cursor-crosshair" : "cursor-default"}`}
        viewBox="0 0 320 180"
        role="img"
        aria-label={markerMode === "lastPoint" ? tx("vehicle.location.mapAria") : tx("vehicle.route.aria")}
        onPointerDown={
          allowMapInteraction
            ? (event) => {
                setHoveredPoint(null);
                dragRef.current = { x: event.clientX, y: event.clientY };
                event.currentTarget.setPointerCapture(event.pointerId);
              }
            : undefined
        }
        onPointerMove={(event) => {
          if (allowMapInteraction && dragRef.current) {
            dragMap(event.clientX, event.clientY, event.currentTarget);
            return;
          }
          updateRouteHover(event.clientX, event.clientY, event.currentTarget);
        }}
        onPointerUp={
          allowMapInteraction
            ? (event) => {
                dragRef.current = null;
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            : undefined
        }
        onPointerCancel={
          allowMapInteraction
            ? () => {
                dragRef.current = null;
              }
            : undefined
        }
        onPointerLeave={() => setHoveredPoint(null)}
        onWheel={
          allowMapInteraction
            ? (event) => {
                event.preventDefault();
                if (event.deltaY < 0) {
                  onZoomIn();
                } else if (event.deltaY > 0) {
                  onZoomOut();
                }
              }
            : undefined
        }
      >
        <defs>
          <filter id="route-line-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="1" stdDeviation="2" floodColor="rgba(0,0,0,0.5)" />
          </filter>
        </defs>
        {routeMap.tiles.map((tile) => (
          <image
            key={tile.key}
            href={tile.url}
            x={tile.x}
            y={tile.y}
            width={MAP_TILE_SIZE}
            height={MAP_TILE_SIZE}
            preserveAspectRatio="none"
          />
        ))}
        <rect width="320" height="180" fill="rgba(5,10,15,0.16)" />
        {selectedLayer === "route" && solidRoutePath ? (
          <path
            d={solidRoutePath}
            fill="none"
            stroke={ROUTE_LINE_COLOR}
            strokeWidth={ROUTE_STROKE_WIDTH}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="nonScalingStroke"
            filter="url(#route-line-shadow)"
          />
        ) : null}
        {metricGradientStroke ? (
          <>
            <linearGradient
              id={gradientId}
              gradientUnits="userSpaceOnUse"
              x1={metricGradientStroke.start.x}
              y1={metricGradientStroke.start.y}
              x2={metricGradientStroke.end.x}
              y2={metricGradientStroke.end.y}
            >
              {metricGradientStroke.stops.map((stop, index) => (
                <stop
                  key={`${metricGradientStroke.key}-${index}`}
                  offset={`${(stop.offset * 100).toFixed(2)}%`}
                  stopColor={stop.color}
                />
              ))}
            </linearGradient>
            <path
              d={metricGradientStroke.d}
              fill="none"
              stroke={`url(#${gradientId})`}
              strokeWidth={ROUTE_STROKE_WIDTH}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="nonScalingStroke"
              filter="url(#route-line-shadow)"
            />
          </>
        ) : null}
        {markerMode === "lastPoint" && mappedEnd ? (
          <circle cx={mappedEnd.x} cy={mappedEnd.y} r="6" fill="#38bdf8" stroke="rgba(0,0,0,0.55)" strokeWidth="2">
            <title>{tx("vehicle.location.lastKnown")}</title>
          </circle>
        ) : null}
        {markerMode === "trip" && mappedStart ? (
          <circle cx={mappedStart.x} cy={mappedStart.y} r="5" fill="#22c55e" stroke="rgba(0,0,0,0.55)" strokeWidth="2">
            <title>{tx("vehicle.route.start")}</title>
          </circle>
        ) : null}
        {markerMode === "trip" && mappedEnd && route.totalPoints > 1 ? (
          <circle cx={mappedEnd.x} cy={mappedEnd.y} r="5" fill="#facc15" stroke="rgba(0,0,0,0.55)" strokeWidth="2">
            <title>{tx("vehicle.route.end")}</title>
          </circle>
        ) : null}
        {hoveredPoint ? (
          <circle
            cx={hoveredPoint.x}
            cy={hoveredPoint.y}
            r="4.5"
            fill="#ffffff"
            stroke={ROUTE_LINE_COLOR}
            strokeWidth="2"
            pointerEvents="none"
          />
        ) : null}
      </svg>
    </div>
  );
}

function MapIconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex size-8 items-center justify-center rounded-full border border-border bg-background/85 text-foreground shadow-sm backdrop-blur transition hover:border-primary/50 hover:text-primary sm:size-9"
      title={label}
      aria-label={label}
    >
      {children}
    </button>
  );
}

function LiveLocationMap({
  location,
  deviceTimeMs,
  telemetry,
}: {
  location: BydmateLocation;
  deviceTimeMs: number;
  telemetry: BydmateTelemetry;
}) {
  const { t } = useTranslation();
  const tx = t as Translator;
  const route = useMemo(
    () => prepareLiveLocationRoute(location, deviceTimeMs, telemetry),
    [deviceTimeMs, location, telemetry],
  );
  const baseZoom = useMemo(() => chooseRouteZoom(route), [route]);
  const [zoomOffset, setZoomOffset] = useState(0);
  const [pan, setPan] = useState<MapPan>({ x: 0, y: 0 });
  const panRef = useRef(pan);
  panRef.current = pan;
  const [selectedLayer, setSelectedLayer] = useState<RouteLayer>("route");
  const [isFullscreenOpen, setIsFullscreenOpen] = useState(false);
  const lat = validNumber(location.lat);
  const lon = validNumber(location.lon);

  if (route.totalPoints === 0 || lat == null || lon == null) return null;

  const zoomBy = (delta: number) => {
    setZoomOffset((offset) => {
      const next = stepRouteMapZoom(baseZoom, offset, panRef.current, delta);
      if (next.zoomOffset !== offset) {
        setPan(next.pan);
      }
      return next.zoomOffset;
    });
  };
  const zoomIn = () => zoomBy(1);
  const zoomOut = () => zoomBy(-1);
  const resetView = () => {
    setZoomOffset(0);
    setPan({ x: 0, y: 0 });
  };

  const canvasProps = {
    route,
    zoomOffset,
    pan,
    onPanChange: setPan,
    onZoomIn: zoomIn,
    onZoomOut: zoomOut,
    onResetView: resetView,
    selectedLayer,
    onLayerChange: setSelectedLayer,
    markerMode: "lastPoint" as const,
  };

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-border bg-background">
        <InteractiveRouteCanvas
          {...canvasProps}
          onOpenFullscreen={() => setIsFullscreenOpen(true)}
          showLayerLegend={false}
          showToolbarControls={false}
          className="h-40"
        />
        <div className="border-t border-border px-3 py-2 text-center font-mono text-[11px] tabular-nums text-muted-foreground">
          {lat.toFixed(5)}, {lon.toFixed(5)}
        </div>
        <div className="border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground">
          {tx("vehicle.route.mapData")} &copy;{" "}
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            OpenStreetMap contributors
          </a>
        </div>
      </div>
      <Dialog open={isFullscreenOpen} onOpenChange={setIsFullscreenOpen}>
        <DialogContent className="h-[calc(100dvh-1rem)] max-w-[calc(100vw-1rem)] gap-3 p-3 sm:max-w-[calc(100vw-2rem)]">
          <DialogTitle className="sr-only">{tx("vehicle.location.lastKnown")}</DialogTitle>
          <InteractiveRouteCanvas
            {...canvasProps}
            onCloseFullscreen={() => setIsFullscreenOpen(false)}
            showLayerLegend={false}
            showToolbarControls
            className="min-h-0 flex-1 rounded-lg"
            isFullscreen
          />
          <div className="px-1 text-[11px] text-muted-foreground">
            {tx("vehicle.route.mapData")} &copy;{" "}
            <a
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              OpenStreetMap contributors
            </a>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function LocationCard({
  snapshot,
  hasMounted = true,
}: {
  snapshot: BydmateLiveSnapshotRow;
  hasMounted?: boolean;
}) {
  const { locale, t } = useTranslation();
  const tx = t as Translator;
  const loc = snapshot.location;
  const hasLiveLocation = typeof loc.lat === "number" && typeof loc.lon === "number";

  // Fall back to the last GPS point of the latest trip when the live snapshot has no location.
  const { data: latestTrips = [] } = useLatestBydmateTripsQuery(snapshot.vehicle_id, 1);
  const lastTripId = hasLiveLocation ? null : (latestTrips[0]?.id ?? null);
  const {
    data: trackPoints = [],
    isLoading: isTrackLoading,
  } = useBydmateTripTrackQuery(lastTripId);

  const lastTrackPoint = trackPoints[trackPoints.length - 1] ?? null;
  const usingLastTripFinish =
    !hasLiveLocation &&
    lastTrackPoint != null &&
    validNumber(lastTrackPoint.lat) != null &&
    validNumber(lastTrackPoint.lon) != null;

  const displayLat = hasLiveLocation
    ? (loc.lat as number)
    : validNumber(lastTrackPoint?.lat);
  const displayLon = hasLiveLocation
    ? (loc.lon as number)
    : validNumber(lastTrackPoint?.lon);
  const hasAnyLocation = displayLat != null && displayLon != null;

  const locationDeviceTimeMs = hasLiveLocation
    ? Date.parse(snapshot.device_time)
    : lastTrackPoint
      ? Date.parse(lastTrackPoint.device_time)
      : Number.NaN;
  const deviceTimeLabel =
    hasMounted && Number.isFinite(locationDeviceTimeMs)
      ? new Date(locationDeviceTimeMs).toLocaleString(localeCode(locale))
      : "—";

  return (
    <Card size="sm" className="voltflow-card gap-2 border-border bg-transparent">
      <CardHeader className="px-3 pt-3 pb-0">
        <CardTitle className="flex items-center gap-2 text-base tracking-tight">
          <MapPin className="size-4 text-primary" aria-hidden />
          {tx("vehicle.location.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 px-3 pb-3 text-sm">
        {isTrackLoading && lastTripId ? (
          <Skeleton className="h-40 rounded-xl" />
        ) : hasLiveLocation ? (
          <LiveLocationMap
            location={loc}
            deviceTimeMs={Date.parse(snapshot.device_time)}
            telemetry={snapshot.telemetry}
          />
        ) : usingLastTripFinish && lastTrackPoint ? (
          <LiveLocationMap
            location={{
              lat: lastTrackPoint.lat,
              lon: lastTrackPoint.lon,
              accuracy_m: lastTrackPoint.accuracy_m,
            }}
            deviceTimeMs={Date.parse(lastTrackPoint.device_time)}
            telemetry={{
              power_kw: lastTrackPoint.power_kw,
              speed_kmh: lastTrackPoint.speed_kmh,
              soc: lastTrackPoint.soc,
            }}
          />
        ) : (
          <p className="text-muted-foreground">{tx("vehicle.location.empty")}</p>
        )}
        {hasAnyLocation ? (
          <p className="text-center font-mono text-[11px] tabular-nums text-muted-foreground">
            {displayLat.toFixed(5)}, {displayLon.toFixed(5)}
            {!hasLiveLocation ? (
              <span className="ml-1.5 text-muted-foreground/60">({tx("vehicle.location.lastTrip")})</span>
            ) : null}
          </p>
        ) : null}
        <div className="space-y-0">
          <Row label={tx("vehicle.location.deviceTime")} value={deviceTimeLabel} />
          {hasLiveLocation ? (
            <Row label={tx("vehicle.location.accuracy")} value={`${fmt(loc.accuracy_m, 1)} m`} />
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border py-2 first:border-t-0 first:pt-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-heading text-sm font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function LastTripCard({
  vehicleId,
  hasMounted = true,
}: {
  vehicleId: string;
  hasMounted?: boolean;
}) {
  const { t } = useTranslation();
  const appPath = useAppPath();
  const tx = t as Translator;
  const { data: trips = [], isLoading } = useLatestBydmateTripsQuery(vehicleId, 1);
  const trip = trips[0] ?? null;

  return (
    <section className="voltflow-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-heading text-xl font-semibold tracking-tight">
            {tx("vehicle.trips.lastTrip")}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {tx("vehicle.trips.olderInHistory")}
          </p>
        </div>
        <Link
          href={appPath("/history?tab=trips")}
          className="shrink-0 rounded-full border border-border bg-white/[0.03] px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground transition hover:border-primary/50 hover:text-foreground"
        >
          {tx("vehicle.trips.viewHistory")}
        </Link>
      </div>

      {isLoading ? (
        <div className="mt-3">
          <Skeleton className="h-24 rounded-xl" />
        </div>
      ) : !trip ? (
        <p className="mt-3 rounded-xl border border-border bg-white/[0.03] p-3 text-xs text-muted-foreground">
          {tx("vehicle.trips.empty")}
        </p>
      ) : (
        <LastTripDetail trip={trip} hasMounted={hasMounted} />
      )}
    </section>
  );
}

function LastTripDetail({
  trip,
  hasMounted = true,
}: {
  trip: BydmateTripRow;
  hasMounted?: boolean;
}) {
  const { t } = useTranslation();
  const tx = t as Translator;
  const startMs = Date.parse(trip.started_at);
  const endMs = Date.parse(trip.ended_at ?? trip.last_device_time);
  const durationMs = Math.max(0, endMs - startMs);
  const timeRangeLabel = hasMounted
    ? `${formatClock(startMs)} — ${formatClock(endMs)}`
    : "—";
  const dateLabel = hasMounted
    ? new Date(startMs).toLocaleDateString()
    : "—";

  return (
    <div className="mt-3 grid gap-2">
      <div className="rounded-xl border border-primary bg-primary/10 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-heading text-base font-semibold tracking-tight" suppressHydrationWarning>
              {timeRangeLabel}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground" suppressHydrationWarning>
              {formatDuration(durationMs)} · {dateLabel}
            </p>
          </div>
          <span className="rounded-full border border-border bg-background/40 px-2.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {tx("vehicle.trips.pointShort", { value: trip.sample_count })}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 min-[380px]:grid-cols-[repeat(auto-fit,minmax(5.5rem,1fr))]">
          <MiniStat label={tx("vehicle.trips.distance")} value={`${fmt(trip.distance_km, 1)} km`} />
          <MiniStat label={tx("vehicle.trips.regen")} value={`${fmt(trip.regen_energy_kwh, 2)} kWh`} />
          <MiniStat label={tx("vehicle.trips.traction")} value={`${fmt(trip.traction_energy_kwh, 2)} kWh`} />
          <MiniStat label="SOC" value={`${fmt(trip.soc_start)}% → ${fmt(trip.soc_end)}%`} />
          <MiniStat label={tx("vehicle.trips.consumption")} value={`${fmt(trip.avg_consumption_kwh_100km, 1)} kWh/100`} />
          <MiniStat label={tx("vehicle.trips.maxSpeed")} value={`${fmt(trip.max_speed_kmh)} km/h`} />
          <MiniStat label={tx("vehicle.trips.avgSpeed")} value={`${fmt(trip.avg_speed_kmh)} km/h`} />
        </div>
      </div>
      <ExpandedTripPanel tripId={trip.id} trip={trip} />
    </div>
  );
}

function EmptyVehicleState() {
  const { t } = useTranslation();
  const tx = t as Translator;

  return (
    <div className="safe-bottom flex flex-col gap-3 px-4 pb-6 pt-4">
      <Header />
      <section className="voltflow-card p-4">
        <CarFront className="size-10 text-primary" aria-hidden />
        <h1 className="mt-5 font-heading text-3xl font-bold tracking-normal">
          {tx("vehicle.empty.title")}
        </h1>
        <p className="mt-3 text-muted-foreground leading-7">
          {tx("vehicle.empty.beforeEndpoint")}{" "}
          <span className="font-mono">/api/bydmate/telemetry</span>.
          {" "}
          {tx("vehicle.empty.afterEndpoint")}
        </p>
        <div className="mt-5 rounded-2xl border border-border bg-white/[0.03] p-4 text-sm text-muted-foreground">
          <Clock3 className="mb-2 size-4 text-primary" aria-hidden />
          {tx("vehicle.empty.refresh")}
        </div>
      </section>
    </div>
  );
}