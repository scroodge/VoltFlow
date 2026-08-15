"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { track } from "@vercel/analytics";
import dynamic from "next/dynamic";
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
import { CurrencyAmount } from "@/components/currency-amount";
import { useVehicleDevSnapshotOverride } from "@/components/dev/vehicle-dev-snapshot-context";
import { VehicleAnalyticsTeaser } from "@/components/vehicle/vehicle-analytics-teaser";
import { VehicleControlPanel } from "@/components/vehicle/vehicle-control-panel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useBydmateLiveQuery } from "@/hooks/use-bydmate-live-query";
import { useProfileQuery } from "@/hooks/use-profile-query";
import { useVehicleRangeEstimate } from "@/hooks/use-vehicle-range-estimate";
import { useVehicleLastKnownLocation } from "@/hooks/use-vehicle-last-known-location";
import {
  useBydmateTripRealtimeInvalidation,
  useBydmateTripsQuery,
  useLatestBydmateTripsQuery,
} from "@/hooks/use-bydmate-trips-query";
import { useCarsQuery } from "@/hooks/use-cars-query";
import { useSessionsQuery } from "@/hooks/use-sessions-query";
import { useTickingClock } from "@/hooks/use-ticking-clock";
import { useTranslation } from "@/hooks/use-translation";
import { useAppPath } from "@/lib/dev/dev-path";
import {
  formatPressureFromKpa,
  isTyrePressureKpa,
} from "@/lib/pressure-units";
import { gearIsPark, readGear } from "@/lib/bydmate/gear";
import { isTelemetryCharging } from "@/features/charging/domain";
import {
  computeHeroDriveMetrics,
  formatHeroDistanceKm,
  formatKmPerPercent,
} from "@/lib/bydmate/hero-drive-metrics";
import { calculateTripEnergy } from "@/lib/bydmate/trip-energy";
import {
  tripEnergyPerKm,
  tripNetConsumptionKwh100,
  tripTractionEnergyKwh,
  weightedAvgConsumptionKwh100,
} from "@/lib/bydmate/trip-metrics";
import { isRouteTrackDisplayable } from "@/lib/bydmate/route-insights";
import { resolvePreferredTripDistanceKm, trackPathDistanceKm } from "@/lib/bydmate/trip-distance";
import type { Currency, Locale, TranslationKey } from "@/lib/i18n";
import { formatTimeAgo } from "@/lib/time-ago";
import { vehicleReadyDurationBucket } from "@/lib/vehicle-ready-metrics";
import { readDiPlusCabinTemperature } from "@/lib/vehicle-cabin-temperature";
import {
  deriveDashboardVehicleMode,
  isFreshLiveSnapshot,
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
  ChargingSessionRow,
} from "@/types/database";
import { ChargingDeltaCard } from "@/features/charging/ui";
import {
  chargingParamsFromSession,
  deriveSessionProgressFromSoc,
  energyNeededKwh,
  resolveChargingEtaPowerKw,
  resolveDisplayChargePowerKw,
  secondsUntilTargetSoc,
  snapshotChargePowerKw,
} from "@/features/charging/domain";

const TripDetailPanel = dynamic(
  () => import("@/components/vehicle/TripDetailPanel").then((module) => module.TripDetailPanel),
  {
    loading: () => <Skeleton className="mt-3 h-64 rounded-2xl" />,
  },
);

function fmt(value: number | null | undefined, digits = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "—";
}

function fmtTemp(value: number | null | undefined, digits = 1) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < -50 || value > 90) {
    return "—";
  }
  return `${value.toFixed(digits)} °C`;
}

function isMissingMetricValue(value: ReactNode) {
  if (typeof value !== "string") return false;
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
  // 4 items read cleaner as a balanced 2×2 than as 3 + a lonely tile on the second row
  // (also gives wider tiles so longer labels like "Cost at 100%" don't wrap).
  if (count === 4) return "grid grid-cols-2 gap-2";
  return "grid grid-cols-2 gap-2 min-[380px]:grid-cols-3";
}

type Translator = (key: TranslationKey, values?: Record<string, string | number>) => string;

function localeCode(locale: Locale) {
  return locale === "be" ? "be-BY" : locale === "ru" ? "ru-RU" : "en-US";
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
  const vehicleReadyReported = useRef(false);
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
  useBydmateTripRealtimeInvalidation();

  useEffect(() => {
    if (vehicleReadyReported.current || isLoading || !snapshot) return;

    const navigation = performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined;
    // Navigation Timing describes the document, not an App Router transition. Keep this
    // event cold-document-only until a route-transition mark has its own measured seam.
    if (!navigation || new URL(navigation.name).pathname !== window.location.pathname) return;

    vehicleReadyReported.current = true;
    const durationMs = Math.round(performance.now());
    performance.mark("voltflow:vehicle-live-ready");
    track("vehicle_live_ready", {
      duration_bucket: vehicleReadyDurationBucket(durationMs),
      navigation_type: navigation.type,
      release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
    });
  }, [isLoading, snapshot]);

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
  const cabinTempC = readDiPlusCabinTemperature({
    modelGeneration: matchedCar?.model_generation,
    isParkedOrCharging: isCharging || vehicleMode === "parked",
    diplusInsideTempC: snapshot.diplus?.inside_temp_c,
  });
  // Asleep counts as stale for everything that needs *live* data (trip query, live map):
  // a suspended head unit has nothing current to show. The two differ only in how the state
  // is labelled to the user — see LIVE_SNAPSHOT_ASLEEP_MS.
  const isStale = vehicleMode === "stale" || vehicleMode === "asleep";
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
  // Not gated by isCharging: Math Range (kmPerPercentSoc × SOC) needs the last drive's
  // efficiency, which the live snapshot can't supply while charging (the daemon doesn't
  // send current-trip consumption). Without these trips Math Range falls back to live
  // consumption — null during charge — and shows "—".
  const { data: recentTrips = [] } = useLatestBydmateTripsQuery(
    snapshot.vehicle_id,
    50,
    !fixturePoints && Boolean(snapshot.vehicle_id),
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
  // Active charging session for this car. The ~1 Hz persist/auto-complete is owned globally
  // by ChargingSessionBackgroundSync (MobileShell), so here we only read it for display.
  const activeChargingSession = useMemo<ChargingSessionRow | null>(
    () =>
      sessions.find(
        (s) => s.status === "charging" && (!matchedCar || s.car_id === matchedCar.id),
      ) ?? null,
    [sessions, matchedCar],
  );
  const rangeEstimate = useVehicleRangeEstimate({
    baseSnapshot: rangeBaseSnapshot,
    scopedVehicleId,
    batteryCapacityKwh,
    // Same rolling ~50 km trip window Math Distance uses (heroDriveMetrics.rangeEstimateTrips),
    // instead of a separate single-latest-trip fetch — keeps AI Distance from being anchored
    // to whichever one trip happened to run last (see CHANGELOG "AI Distance: share the
    // ~50 km window with Math Distance").
    recentTripsOverride: fixtureTrips ?? heroDriveMetrics.rangeEstimateTrips,
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
  const parkedAvgConsumptionKwh100 = useMemo(
    () => weightedAvgConsumptionKwh100(heroDriveMetrics.rangeEstimateTrips),
    [heroDriveMetrics.rangeEstimateTrips],
  );
  const parkedRecentEnergyKwh =
    parkedAvgConsumptionKwh100 != null ? parkedAvgConsumptionKwh100 / 2 : null;
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
        parkedRecentEnergyKwh={parkedRecentEnergyKwh}
      />
      {isCharging ? (
        <>
          <ChargingModeCard
            snapshot={snapshot}
            session={activeChargingSession}
            nowMs={nowMs}
            cabinTempC={cabinTempC}
          />
          <RestMetricsCard
            snapshot={snapshot}
            rangeLabel={rangeLabel}
            mathRangeLabel={mathRangeLabel}
          />
          {!isStale ? <TirePressureCard snapshot={snapshot} /> : null}
          {activeChargingSession ? (
            <ChargingDeltaCard
              session={activeChargingSession}
              vehicleId={scopedVehicleId ?? snapshot.vehicle_id}
            />
          ) : null}
          {!fixturePoints && isAdmin ? (
            <VehicleControlPanel
              vehicleId={scopedVehicleId ?? snapshot.vehicle_id}
              collapsible
            />
          ) : null}
        </>
      ) : (
        <>
          {!fixturePoints && isAdmin ? (
            <VehicleControlPanel
              vehicleId={scopedVehicleId ?? snapshot.vehicle_id}
              collapsible
            />
          ) : null}
          <CellHealthCard snapshot={snapshot} />
          {isStale ? (
            <>
              <StaleTelemetryNotice />
              <LastTripCard vehicleId={snapshot.vehicle_id} hasMounted={hasMounted} />
              {!fixturePoints ? <VehicleAnalyticsTeaser /> : null}
              <DeferredLocationCard snapshot={snapshot} hasMounted={hasMounted} />
            </>
          ) : (
            <>
              <TelemetryGrid snapshot={snapshot} vehicleMode={vehicleMode} cabinTempC={cabinTempC} />
              <TirePressureCard snapshot={snapshot} />
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
              <DeferredLocationCard snapshot={snapshot} hasMounted={hasMounted} />
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
    // Not the warning colour: a sleeping car is resting normally, not in trouble.
    case "asleep":
      return "border-slate-300/20 bg-slate-300/10 text-slate-200";
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
  parkedRecentEnergyKwh,
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
  parkedRecentEnergyKwh: number | null;
}) {
  const { locale, t: translate } = useTranslation();
  const t = translate as Translator;
  const telemetry = snapshot.telemetry;
  const coreMetrics = heroCoreMetrics(snapshot, t, locale);
  const primaryMetrics: { key: string; icon: typeof Gauge; label: string; value: ReactNode; hint?: string }[] = [
    {
      key: "aiRange",
      icon: Route,
      label: t("vehicle.metrics.aiRange"),
      value: rangeLabel,
      hint: t("vehicle.metrics.aiRangeHint"),
    },
    {
      key: "mathRange",
      icon: Activity,
      label: t("vehicle.metrics.mathRange"),
      value: mathRangeLabel,
      hint: t("vehicle.metrics.mathRangeHint"),
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
              ? t("vehicle.lastUpdate", {
                  value: formatTimeAgo(snapshot.received_at, nowMs, t) ?? "\u2014",
                })
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

      {/* While charging, all metrics move to the highlighted charging card + rest card
          below — the hero keeps only SOC / status / last update. */}
      {!isCharging ? (
        <>
          <div className={`mt-4 ${telemetryGridClass(primaryMetrics.length)}`}>
            {primaryMetrics.map((metric) => (
              <HeroMetric
                key={metric.key}
                icon={metric.icon}
                label={metric.label}
                value={metric.value}
                hint={metric.hint}
              />
            ))}
          </div>

          {(() => {
            const modeMetrics: {
              key: string;
              icon: typeof Gauge;
              label: string;
              value: string;
              supportingText?: string;
              valueCentered?: boolean;
            }[] = [];

            if (isStale) {
              modeMetrics.push(...driveMetrics);
            } else if (vehicleMode === "parked") {
              modeMetrics.push(
                ...driveMetrics,
                {
                  key: "recentEnergy",
                  icon: Gauge,
                  label: t("vehicle.metrics.recentEnergy"),
                  value: `~${fmt(parkedRecentEnergyKwh, 1)} kWh`,
                  supportingText: t("vehicle.metrics.recentEnergyContext"),
                  valueCentered: true,
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
                    supportingText={metric.supportingText}
                    valueCentered={metric.valueCentered}
                  />
                ))}
              </div>
            );
          })()}
        </>
      ) : null}
    </section>
  );
}

function HeroMetric({
  icon: Icon,
  label,
  value,
  supportingText,
  hint,
  valueCentered = false,
}: {
  icon: typeof Gauge;
  label: string;
  value: ReactNode;
  supportingText?: string;
  hint?: string;
  valueCentered?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border border-border bg-white/[0.03] p-2.5 ${
        valueCentered ? "relative min-h-[5.25rem]" : ""
      }`}
      title={hint}
    >
      <Icon className="mb-1 size-3.5 text-primary" aria-hidden />
      <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p
        className={
          valueCentered
            ? "absolute inset-x-2.5 top-1/2 -translate-y-[5px] font-heading text-base font-semibold tabular-nums"
            : "mt-0.5 font-heading text-base font-semibold tabular-nums"
        }
      >
        {value}
      </p>
      {valueCentered && supportingText ? (
        <p className="absolute inset-x-2.5 bottom-2.5 text-[10px] font-medium text-muted-foreground">
          {supportingText}
        </p>
      ) : null}
    </div>
  );
}

function ChargingModeCard({
  snapshot,
  session,
  nowMs,
  cabinTempC,
}: {
  snapshot: BydmateLiveSnapshotRow;
  session: ChargingSessionRow | null;
  nowMs: number;
  cabinTempC: number | null;
}) {
  const { locale, t } = useTranslation();
  const tx = t as Translator;
  const currency = useAppPreferences((s) => s.currency) as Currency;
  const telemetry = snapshot.telemetry;
  // Charging projection from the active session + live SOC. Persist is global
  // (ChargingSessionBackgroundSync) — these are display-only. Time-left uses the local
  // formatDuration(ms); cost is the projected total at 100% in the user's currency.
  const chargeSummary = useMemo(() => {
    const liveSoc = telemetry.soc;
    if (!session || typeof liveSoc !== "number") return null;
    const params = chargingParamsFromSession(session);
    const fallbackPowerKw = resolveDisplayChargePowerKw({
      snapshot,
      sessionChargerPowerKw: params.chargerPowerKw,
    });
    const clampedSoc = Math.min(liveSoc, params.targetPercent);
    const deliveredKwh = deriveSessionProgressFromSoc(params, clampedSoc).chargedEnergyKwh;
    const batteryGainKwh = energyNeededKwh(
      params.batteryCapacityKwh,
      params.startPercent,
      clampedSoc,
    );
    const elapsedSeconds = session.started_at
      ? Math.max(0, (nowMs - Date.parse(session.started_at)) / 1000)
      : 0;
    const chargePowerKw = resolveChargingEtaPowerKw({
      freshLivePowerKw: isFreshLiveSnapshot(snapshot, nowMs)
        ? snapshotChargePowerKw(snapshot)
        : null,
      chargedGridEnergyKwh: deliveredKwh,
      elapsedSeconds,
      socGainPercent: clampedSoc - params.startPercent,
      fallbackPowerKw,
      isDc:
        session.tariff_type === "fast_dc" ||
        snapshot.telemetry.charge_type?.toUpperCase() === "DC",
    });
    const fullCost = deriveSessionProgressFromSoc(params, params.targetPercent).estimatedCost;
    const secsLeft = secondsUntilTargetSoc(
      chargePowerKw != null
        ? {
            ...params,
            chargerPowerKw: chargePowerKw * (params.efficiencyPercent / 100),
          }
        : params,
      clampedSoc,
    );
    return {
      timeLeftLabel: secsLeft != null && secsLeft > 0 ? formatDuration(secsLeft * 1000) : null,
      gridEnergyLabel: `${deliveredKwh.toFixed(2)} kWh`,
      batteryGainLabel: `${batteryGainKwh.toFixed(2)} kWh`,
      fullCostLabel: <CurrencyAmount currency={currency} value={fullCost} locale={locale} />,
      chargePowerKw,
    };
  }, [session, snapshot, telemetry.soc, telemetry.charge_power_kw, currency, locale, nowMs]);
  const items = [
    { key: "chargeTimeLeft", icon: Clock3, label: tx("charging.remaining"), value: chargeSummary?.timeLeftLabel ?? "—" },
    { key: "chargeFromGrid", icon: BatteryCharging, label: tx("charging.energyFromChargerEstimate"), value: chargeSummary?.gridEnergyLabel ?? "—" },
    { key: "chargeToBattery", icon: BatteryCharging, label: tx("charging.energyToBatteryEstimate"), value: chargeSummary?.batteryGainLabel ?? "—" },
    { key: "chargeFullCost", icon: Activity, label: tx("charging.fullCost"), value: chargeSummary?.fullCostLabel ?? "—" },
    {
      key: "chargePower",
      icon: Zap,
      label: tx("vehicle.telemetry.chargePower"),
      value: `${telemetry.charge_type ? `${telemetry.charge_type} · ` : ""}~ ${fmt(chargeSummary?.chargePowerKw ?? telemetry.charge_power_kw, 1)} kW`,
    },
    { key: "batteryTemp", icon: Thermometer, label: tx("vehicle.telemetry.batteryTemp"), value: fmtTemp(telemetry.battery_temp_c) },
    { key: "cabinTemp", icon: Thermometer, label: tx("vehicle.telemetry.cabinTemp"), value: fmtTemp(cabinTempC) },
    { key: "outsideTemp", icon: Thermometer, label: tx("vehicle.telemetry.outsideTemp"), value: fmtTemp(telemetry.outside_temp_c) },
  ];
  const visibleItems = items.filter((item) => !isMissingMetricValue(item.value));

  return (
    <Card className="border-cyan-300/20 bg-cyan-300/[0.06]">
      <CardHeader className="p-3 pb-2">
        <CardTitle className="flex items-center gap-2 font-heading text-base">
          <BatteryCharging className="size-5 text-cyan-100" aria-hidden />
          {tx("vehicle.chargingMode.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-2 p-3 pt-0">
        {visibleItems.map((item) => (
          <HeroMetric key={item.key} icon={item.icon} label={item.label} value={item.value} />
        ))}
      </CardContent>
    </Card>
  );
}

// Non-charging hero metrics (ranges, 12V, odometer), regrouped into their own card
// while a charge is active so the charging card can lead.
function RestMetricsCard({
  snapshot,
  rangeLabel,
  mathRangeLabel,
}: {
  snapshot: BydmateLiveSnapshotRow;
  rangeLabel: string;
  mathRangeLabel: string;
}) {
  const { locale, t: translate } = useTranslation();
  const t = translate as Translator;
  const items: { key: string; icon: typeof Gauge; label: string; value: ReactNode; hint?: string }[] = [
    { key: "aiRange", icon: Route, label: t("vehicle.metrics.aiRange"), value: rangeLabel, hint: t("vehicle.metrics.aiRangeHint") },
    { key: "mathRange", icon: Activity, label: t("vehicle.metrics.mathRange"), value: mathRangeLabel, hint: t("vehicle.metrics.mathRangeHint") },
    ...heroCoreMetrics(snapshot, t, locale),
  ];
  const visibleItems = items.filter((item) => !isMissingMetricValue(item.value));
  if (visibleItems.length === 0) return null;

  return (
    <section className="voltflow-card p-4">
      <div className={telemetryGridClass(visibleItems.length)}>
        {visibleItems.map((item) => (
          <HeroMetric key={item.key} icon={item.icon} label={item.label} value={item.value} hint={item.hint} />
        ))}
      </div>
    </section>
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

function TelemetryGrid({
  snapshot,
  vehicleMode,
  cabinTempC,
}: {
  snapshot: BydmateLiveSnapshotRow;
  vehicleMode: DashboardVehicleMode;
  cabinTempC: number | null;
}) {
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
        key: "cabinTemp",
        icon: Thermometer,
        label: tx("vehicle.telemetry.cabinTemp"),
        value: fmtTemp(cabinTempC),
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

    if (vehicleMode === "parked") {
      return all.filter(
        (item) => item.key === "batteryTemp" || item.key === "cabinTemp" || item.key === "outsideTemp",
      );
    }

    return all.filter((item) => {
      if (item.when === "charging") {
        if (!isCharging) return false;
      } else if (item.when === "driving") {
        if (isCharging) return false;
      }
      return !isMissingMetricValue(item.value);
    });
  }, [cabinTempC, isCharging, telemetry, tx, vehicleMode]);

  if (items.length === 0) return null;

  return (
    <div className={items.length === 2 ? "grid grid-cols-2 gap-2" : telemetryGridClass(items.length)}>
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

function tirePressureKpa(value: unknown) {
  return isTyrePressureKpa(value) ? value : null;
}

function TirePressureCard({ snapshot }: { snapshot: BydmateLiveSnapshotRow }) {
  const { t } = useTranslation();
  const { data: profile } = useProfileQuery();
  const tx = t as Translator;
  const pressureUnit = profile?.preferred_pressure_unit ?? "kPa";
  const tires = [
    {
      key: "frontLeft",
      label: "FL",
      value: tirePressureKpa(snapshot.diplus?.tire_press_fl_kpa),
    },
    {
      key: "frontRight",
      label: "FR",
      value: tirePressureKpa(snapshot.diplus?.tire_press_fr_kpa),
    },
    {
      key: "rearLeft",
      label: "RL",
      value: tirePressureKpa(snapshot.diplus?.tire_press_rl_kpa),
    },
    {
      key: "rearRight",
      label: "RR",
      value: tirePressureKpa(snapshot.diplus?.tire_press_rr_kpa),
    },
  ];

  if (tires.every((tire) => tire.value == null)) return null;

  return (
    <Card size="sm">
      <CardHeader className="px-3 pt-2 pb-1">
        <CardTitle className="flex items-center gap-1.5 font-heading text-sm">
          <Gauge className="size-4" aria-hidden />
          {tx("vehicle.tirePressure.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3 pt-0">
        <div className="grid grid-cols-2" aria-label={tx("vehicle.tirePressure.title")}>
          {tires.map((tire, index) => (
            <div
              key={tire.key}
              className={`py-2 text-center ${index % 2 === 0 ? "pr-3" : "border-l border-border/60 pl-3"} ${
                index < 2 ? "border-b border-border/60" : ""
              }`}
            >
              <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {tire.label}
              </p>
              <p className="mt-0.5 font-heading text-base font-semibold tabular-nums text-foreground">
                {tire.value == null
                  ? "—"
                  : `${formatPressureFromKpa(tire.value, pressureUnit)} ${pressureUnit}`}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-2 border-t border-border/60 pt-2 text-[11px] leading-4 text-muted-foreground">
          {tx("vehicle.tirePressure.guidance")}
        </p>
      </CardContent>
    </Card>
  );
}

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

function pointTimeMs(point: { device_time: string; received_at?: string }) {
  const deviceMs = Date.parse(point.device_time);
  if (Number.isFinite(deviceMs)) return deviceMs;
  const receivedMs = point.received_at ? Date.parse(point.received_at) : Number.NaN;
  return Number.isFinite(receivedMs) ? receivedMs : 0;
}

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
): ReactNode | null {
  const energyKwh = tripTractionEnergyKwh(trip);
  const costValue =
    energyKwh != null && pricePerKwh > 0 ? energyKwh * pricePerKwh : null;

  return costValue != null ? (
    <CurrencyAmount
      currency={currency}
      value={costValue}
      locale={locale}
      minimumFractionDigits={2}
      maximumFractionDigits={2}
    />
  ) : null;
}

function formatTripEnergyPerKm(trip: BydmateTripRow) {
  const energyPerKm = tripEnergyPerKm(trip);
  return energyPerKm != null ? `${fmt(energyPerKm, 2)} kWh/km` : "—";
}

function formatTripTractionEnergyKwh(trip: BydmateTripRow) {
  const tractionKwh = tripTractionEnergyKwh(trip);
  return tractionKwh != null ? `${fmt(tractionKwh, 2)} kWh` : "—";
}

function formatTripNetConsumptionKwh100(trip: BydmateTripRow) {
  const consumptionKwh100 = tripNetConsumptionKwh100(trip);
  return consumptionKwh100 != null ? `${fmt(consumptionKwh100, 1)} kWh/100 km` : "—";
}

function TripNetConsumptionMetric({ trip, label }: { trip: BydmateTripRow; label: string }) {
  return (
    <div className="mt-3 rounded-xl border border-emerald-300/20 bg-emerald-300/[0.06] px-3 py-2.5">
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-1 font-heading text-lg font-semibold tabular-nums text-emerald-100">
        {formatTripNetConsumptionKwh100(trip)}
      </p>
    </div>
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
  const avgConsumption = weightedAvgConsumptionKwh100(trips);

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
                    <TripDetailPanel tripId={trip.id} trip={trip} />
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
        <MiniStat
          label={tx("vehicle.trips.traction")}
          value={formatTripTractionEnergyKwh(trip)}
        />
        <MiniStat label={tx("vehicle.trips.energyPerKm")} value={formatTripEnergyPerKm(trip)} />
        <MiniStat label="SOC" value={`${fmt(trip.soc_start)}% -> ${fmt(trip.soc_end)}%`} />
        <MiniStat label={tx("vehicle.trips.maxSpeed")} value={`${fmt(trip.max_speed_kmh)} km/h`} />
        <MiniStat label={tx("vehicle.trips.avgSpeed")} value={`${fmt(trip.avg_speed_kmh)} km/h`} />
        {costStr != null ? (
          <MiniStat label={tx("vehicle.trips.cost")} value={costStr} />
        ) : null}
      </div>
      <TripNetConsumptionMetric trip={trip} label={tx("vehicle.trips.netConsumption")} />
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

function MiniStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-1 font-heading text-base font-semibold tabular-nums">{value}</p>
    </div>
  );
}

const TelemetryHistoryCharts = dynamic(
  () =>
    import("@/components/vehicle/vehicle-telemetry-visualizations").then(
      (module) => module.TelemetryHistoryCharts,
    ),
  { loading: () => <Skeleton className="mt-3 h-64 rounded-2xl" /> },
);

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

const RouteMap = dynamic(
  () => import("@/components/vehicle/vehicle-route-map").then((module) => module.RouteMap),
  { loading: () => <Skeleton className="mt-3 h-64 rounded-2xl" /> },
);

const LiveLocationMap = dynamic(
  () => import("@/components/vehicle/vehicle-route-map").then((module) => module.LiveLocationMap),
  { loading: () => <Skeleton className="h-40 rounded-xl" /> },
);

function DeferredLocationCard({
  snapshot,
  hasMounted = true,
}: {
  snapshot: BydmateLiveSnapshotRow;
  hasMounted?: boolean;
}) {
  const [isNearViewport, setIsNearViewport] = useState(false);
  const observeNearViewport = useCallback((element: HTMLDivElement | null) => {
    if (!element) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setIsNearViewport(true);
        observer.disconnect();
      },
      { rootMargin: "300px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={observeNearViewport}>
      {isNearViewport ? (
        <LocationCard snapshot={snapshot} hasMounted={hasMounted} />
      ) : (
        <Skeleton className="h-52 rounded-2xl" />
      )}
    </div>
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
  const { location: resolved, isLoading } = useVehicleLastKnownLocation(
    snapshot.vehicle_id,
    snapshot,
  );

  const deviceTimeMs = resolved ? Date.parse(resolved.deviceTimeIso) : Number.NaN;
  const deviceTimeLabel =
    hasMounted && Number.isFinite(deviceTimeMs)
      ? new Date(deviceTimeMs).toLocaleString(localeCode(locale))
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
        {isLoading ? (
          <Skeleton className="h-40 rounded-xl" />
        ) : resolved?.source === "live" ? (
          <LiveLocationMap
            location={{
              lat: resolved.lat,
              lon: resolved.lon,
              accuracy_m: resolved.accuracyM,
              bearing_deg: resolved.bearingDeg,
            }}
            deviceTimeMs={deviceTimeMs}
            telemetry={snapshot.telemetry}
          />
        ) : resolved?.source === "lastTrip" ? (
          <LiveLocationMap
            location={{
              lat: resolved.lat,
              lon: resolved.lon,
              accuracy_m: resolved.accuracyM,
            }}
            deviceTimeMs={deviceTimeMs}
            telemetry={resolved.telemetry}
          />
        ) : (
          <p className="text-muted-foreground">{tx("vehicle.location.empty")}</p>
        )}
        {resolved ? (
          <p className="text-center font-mono text-[11px] tabular-nums text-muted-foreground">
            {resolved.lat.toFixed(5)}, {resolved.lon.toFixed(5)}
            {resolved.source === "lastTrip" ? (
              <span className="ml-1.5 text-muted-foreground/60">({tx("vehicle.location.lastTrip")})</span>
            ) : null}
          </p>
        ) : null}
        <div className="space-y-0">
          <Row label={tx("vehicle.location.deviceTime")} value={deviceTimeLabel} />
          {resolved?.source === "live" ? (
            <Row label={tx("vehicle.location.accuracy")} value={`${fmt(resolved.accuracyM, 1)} m`} />
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
          <MiniStat
            label={tx("vehicle.trips.traction")}
            value={formatTripTractionEnergyKwh(trip)}
          />
          <MiniStat label={tx("vehicle.trips.energyPerKm")} value={formatTripEnergyPerKm(trip)} />
          <MiniStat label="SOC" value={`${fmt(trip.soc_start)}% → ${fmt(trip.soc_end)}%`} />
          <MiniStat label={tx("vehicle.trips.maxSpeed")} value={`${fmt(trip.max_speed_kmh)} km/h`} />
          <MiniStat label={tx("vehicle.trips.avgSpeed")} value={`${fmt(trip.avg_speed_kmh)} km/h`} />
        </div>
        <TripNetConsumptionMetric trip={trip} label={tx("vehicle.trips.netConsumption")} />
      </div>
      <TripDetailPanel tripId={trip.id} trip={trip} />
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
