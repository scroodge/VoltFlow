"use client";

import { useId, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
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
  Plus,
  Route,
  Thermometer,
  Zap,
} from "lucide-react";

import { BrandBadge } from "@/components/brand/BrandBadge";
import { LogoFull } from "@/components/brand/LogoFull";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useBydmateLiveQuery } from "@/hooks/use-bydmate-live-query";
import { useBydmateTripSamplesQuery } from "@/hooks/use-bydmate-trip-samples-query";
import { useBydmateTripTrackQuery } from "@/hooks/use-bydmate-trip-track-query";
import { useBydmateTripsQuery } from "@/hooks/use-bydmate-trips-query";
import { useTickingClock } from "@/hooks/use-ticking-clock";
import { useTranslation } from "@/hooks/use-translation";
import { calculateCumulativeRegenPoints, calculateTripEnergy } from "@/lib/bydmate/trip-energy";
import type { Locale, TranslationKey } from "@/lib/i18n";
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

function fmtBool(value: boolean | null | undefined, t: Translator) {
  if (value == null) return "—";
  return value ? t("common.yes") : t("common.no");
}

function fmtTemp(value: number | null | undefined, digits = 1) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < -50 || value > 90) {
    return "—";
  }
  return `${value.toFixed(digits)} °C`;
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

export function VehicleLiveView() {
  const { t } = useTranslation();
  const tx = t as Translator;
  const { data, isLoading, error } = useBydmateLiveQuery();
  const nowMs = useTickingClock(true);
  const snapshot = data?.[0] ?? null;

  if (isLoading) {
    return (
      <div className="safe-bottom flex flex-col gap-5 px-4 pb-6 pt-5">
        <Header />
        <Skeleton className="h-40 rounded-[1.75rem]" />
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
      <div className="safe-bottom flex flex-col gap-5 px-4 pb-6 pt-5">
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
    <VehicleLiveContent snapshot={snapshot} nowMs={nowMs} />
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

  return <VehicleLiveContent snapshot={snapshot} nowMs={nowMs} fixturePoints={points} />;
}

function VehicleLiveContent({
  snapshot,
  nowMs,
  fixturePoints,
}: {
  snapshot: BydmateLiveSnapshotRow;
  nowMs: number;
  fixturePoints?: BydmateTelemetryPointRow[];
}) {
  const isCharging = isChargingTelemetry(snapshot.telemetry);
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
  } = useBydmateTripsQuery(selectedDate, snapshot.vehicle_id, !fixturePoints && !isCharging);
  const {
    data: forecastApiTrips = [],
  } = useBydmateTripsQuery(fallbackDate, snapshot.vehicle_id, !fixturePoints && !isCharging && selectedDate !== fallbackDate);
  const trips = fixtureTrips ?? apiTrips;
  const forecastTrips = fixtureTrips ?? (selectedDate === fallbackDate ? apiTrips : forecastApiTrips);
  const [selectedTripId, setSelectedTripId] = useState<string | null | undefined>(undefined);
  const defaultTripId = trips[0]?.id ?? null;
  const expandedTripId = selectedTripId === undefined ? defaultTripId : selectedTripId;
  const expandedFixtureTrip =
    fixtureTripSegments?.find((trip) => trip.id === expandedTripId) ?? null;
  const isStale = nowMs - Date.parse(snapshot.received_at) > 90_000;

  return (
    <div className="safe-bottom flex flex-col gap-5 px-4 pb-6 pt-5">
      <Header />
      <Hero
        snapshot={snapshot}
        nowMs={nowMs}
        isStale={isStale}
        isCharging={isCharging}
        forecastTrips={forecastTrips}
      />
      {isCharging ? (
        <ChargingModeCard snapshot={snapshot} />
      ) : (
        <>
          <CellHealthCard snapshot={snapshot} />
          {isStale ? (
            <StaleTelemetryNotice />
          ) : (
            <TelemetryGrid telemetry={snapshot.telemetry} />
          )}
          <TripBrowser
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
          <LocationCard snapshot={snapshot} />
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

function Hero({
  snapshot,
  nowMs,
  isStale,
  isCharging,
  forecastTrips,
}: {
  snapshot: BydmateLiveSnapshotRow;
  nowMs: number;
  isStale: boolean;
  isCharging: boolean;
  forecastTrips: BydmateTripRow[];
}) {
  const { t: translate } = useTranslation();
  const t = translate as Translator;
  const telemetry = snapshot.telemetry;
  const rangeEstimate = estimateVehicleRangeKm(snapshot, forecastTrips);

  return (
    <section className="voltflow-card overflow-hidden p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-muted-foreground text-xs uppercase tracking-[0.28em]">
            {snapshot.vehicle_id}
          </p>
          <h1 className="mt-3 font-heading text-5xl font-bold tracking-normal tabular-nums">
            {fmt(telemetry.soc)}
            <span className="text-2xl text-muted-foreground">%</span>
          </h1>
          <p className="mt-2 text-muted-foreground" suppressHydrationWarning>
            {t("vehicle.lastUpdate", { value: timeAgo(snapshot.received_at, nowMs, t) })}
          </p>
        </div>
        <span
          className={
            "rounded-full border px-4 py-2 font-heading text-xs font-semibold uppercase tracking-[0.2em] " +
            (isStale
              ? "border-yellow-300/25 bg-yellow-300/10 text-yellow-200"
              : isCharging
                ? "border-cyan-300/25 bg-cyan-300/10 text-cyan-100"
              : "border-primary/25 bg-primary/10 text-primary")
          }
        >
          {isStale ? t("vehicle.status.stale") : isCharging ? t("vehicle.status.charging") : t("vehicle.status.live")}
        </span>
      </div>

      {isStale ? (
        <div className="mt-6 grid grid-cols-3 gap-3">
          <HeroMetric icon={BatteryCharging} label={t("vehicle.metrics.soc")} value={`${fmt(telemetry.soc, 0)}%`} />
          <HeroMetric icon={Activity} label={t("vehicle.metrics.soh")} value={`${fmt(telemetry.soh_percent, 1)}%`} />
          <HeroMetric icon={Route} label={t("vehicle.metrics.range")} value={`${fmt(rangeEstimate.estimatedRangeKm, 0)} km`} />
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-3 gap-3">
          {isCharging ? (
            <>
              <HeroMetric icon={BatteryCharging} label={t("vehicle.telemetry.charging")} value={fmtBool(telemetry.is_charging, t)} />
              <HeroMetric icon={Zap} label={t("vehicle.telemetry.chargePower")} value={`${fmt(telemetry.charge_power_kw, 1)} kW`} />
            </>
          ) : (
            <>
              <HeroMetric icon={Gauge} label={t("vehicle.metrics.speed")} value={`${fmt(telemetry.speed_kmh, 0)} km/h`} />
              <HeroMetric icon={Zap} label={t("vehicle.metrics.power")} value={`${fmt(telemetry.power_kw, 1)} kW`} />
            </>
          )}
          <HeroMetric icon={Route} label={t("vehicle.metrics.range")} value={`${fmt(rangeEstimate.estimatedRangeKm, 0)} km`} />
        </div>
      )}
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
    <div className="rounded-2xl border border-border bg-white/[0.03] p-3">
      <Icon className="mb-2 size-4 text-primary" aria-hidden />
      <p className="text-muted-foreground text-[11px] uppercase tracking-[0.18em]">{label}</p>
      <p className="mt-1 font-heading text-lg font-semibold tabular-nums">{value}</p>
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
      <CardHeader className="p-5 pb-3">
        <CardTitle className="flex items-center gap-2 font-heading text-lg">
          <BatteryCharging className="size-5 text-cyan-100" aria-hidden />
          {tx("vehicle.chargingMode.title")}
        </CardTitle>
        <p className="pt-2 text-sm text-muted-foreground">
          {tx("vehicle.chargingMode.body")}
        </p>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3 p-5 pt-0">
        {items.map((item) => (
          <div key={item.label} className="rounded-2xl border border-cyan-100/10 bg-black/10 p-3">
            <item.icon className="mb-2 size-4 text-cyan-100" aria-hidden />
            <p className="text-muted-foreground text-[11px] uppercase tracking-[0.16em]">
              {item.label}
            </p>
            <p className="mt-1 font-heading text-lg font-semibold tabular-nums">
              {item.value}
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function StaleTelemetryNotice() {
  const { t } = useTranslation();
  const tx = t as Translator;

  return (
    <Card className="border-yellow-300/20 bg-yellow-300/[0.06]">
      <CardContent className="p-5">
        <p className="font-heading text-lg font-semibold tracking-tight text-yellow-100">
          {tx("vehicle.staleTitle")}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          {tx("vehicle.staleBody")}
        </p>
      </CardContent>
    </Card>
  );
}

function TelemetryGrid({ telemetry }: { telemetry: BydmateTelemetry }) {
  const { t } = useTranslation();
  const tx = t as Translator;
  const items = [
    { icon: BatteryCharging, label: tx("vehicle.telemetry.charging"), value: fmtBool(telemetry.is_charging, tx) },
    { icon: Zap, label: tx("vehicle.telemetry.chargePower"), value: `${fmt(telemetry.charge_power_kw, 1)} kW` },
    { icon: Activity, label: tx("vehicle.telemetry.chargeType"), value: telemetry.charge_type ?? "—" },
    { icon: Thermometer, label: tx("vehicle.telemetry.batteryTemp"), value: fmtTemp(telemetry.battery_temp_c) },
    { icon: Thermometer, label: tx("vehicle.telemetry.cabinTemp"), value: fmtTemp(telemetry.cabin_temp_c) },
    { icon: Thermometer, label: tx("vehicle.telemetry.outsideTemp"), value: fmtTemp(telemetry.outside_temp_c) },
    { icon: Activity, label: tx("vehicle.telemetry.odometer"), value: `${fmt(telemetry.odometer_km, 1)} km` },
    { icon: Activity, label: tx("vehicle.telemetry.soh"), value: `${fmt(telemetry.soh_percent, 1)}%` },
    { icon: Zap, label: tx("vehicle.telemetry.auxBattery"), value: `${fmt(telemetry.aux_voltage_v, 1)} V` },
    { icon: Route, label: tx("vehicle.telemetry.tripDistance"), value: `${fmt(telemetry.current_trip_distance_km, 1)} km` },
    {
      icon: Gauge,
      label: tx("vehicle.telemetry.tripConsumption"),
      value: `${fmt(telemetry.current_trip_consumption_kwh_100km, 1)} kWh/100`,
    },
    { icon: BatteryCharging, label: tx("vehicle.telemetry.kwhCharged"), value: `${fmt(telemetry.kwh_charged, 2)} kWh` },
  ];

  return (
    <div className="grid grid-cols-2 gap-3">
      {items.map((item) => (
        <Card key={item.label} className="border-border bg-white/[0.02]">
          <CardContent className="p-4">
            <item.icon className="mb-3 size-5 text-primary" aria-hidden />
            <p className="text-muted-foreground text-xs uppercase tracking-[0.18em]">
              {item.label}
            </p>
            <p className="mt-2 font-heading text-xl font-semibold tracking-normal tabular-nums">
              {item.value}
            </p>
          </CardContent>
        </Card>
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
    <Card className={`border ${cellStatusClasses(status)}`}>
      <CardHeader className="flex-row items-center justify-between space-y-0 p-4 pb-2">
        <CardTitle className="flex items-center gap-2 font-heading text-base">
          <HeartPulse className="size-5" aria-hidden />
          {tx("vehicle.cellHealth.title")}
        </CardTitle>
        <span className="rounded-full border border-current/20 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]">
          {tx(`vehicle.cellHealth.status.${status}`)}
        </span>
      </CardHeader>
      <CardContent className="grid grid-cols-3 gap-3 p-4 pt-2">
        {items.map((item) => (
          <div key={item.label} className="rounded-2xl border border-current/10 bg-black/10 p-3">
            <p className="text-[11px] uppercase tracking-[0.16em] opacity-75">{item.label}</p>
            <p className="mt-1 font-heading text-lg font-semibold tabular-nums">{item.value}</p>
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

type RouteLayer = "route" | "regen" | "power" | "speed" | "soc";

type RouteSegment = {
  key: string;
  path: string;
  color: string;
  opacity: number;
  title: string;
  dash?: string;
};

type ChartSeries = {
  label: string;
  color: string;
  points: ChartPoint[];
};

type TelemetryChart = {
  title: string;
  unit: string;
  valueDigits: number;
  series: ChartSeries[];
  minValue: number;
  maxValue: number;
  minTime: number;
  maxTime: number;
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
const MAX_CHART_MARKERS = 80;
const MAX_DELTA_BY_SOC_POINTS = 240;
const MAX_ROUTE_POINTS = 400;
const MAP_VIEW_WIDTH = 320;
const MAP_VIEW_HEIGHT = 180;
const MAP_TILE_SIZE = 256;
const MAX_MAP_ZOOM = 18;
const MIN_MAP_ZOOM = 2;
const DEFAULT_MAP_ZOOM = 15;
const WEB_MERCATOR_MAX_LAT = 85.05112878;
const MAX_MAP_ZOOM_OFFSET = 3;
const MIN_MAP_ZOOM_OFFSET = -3;
const DEFAULT_USABLE_BATTERY_KWH = 45.1;
const DEFAULT_CONSUMPTION_KWH_100KM = 18.5;
const MIN_FORECAST_CONSUMPTION_KWH_100KM = 8;
const MAX_FORECAST_CONSUMPTION_KWH_100KM = 42;
const ROUTE_LAYER_OPTIONS: Array<{
  id: RouteLayer;
  label: string;
  color: string;
}> = [
  { id: "route", label: "Route", color: "var(--voltflow-cyan)" },
  { id: "regen", label: "Regen", color: "#34d399" },
  { id: "power", label: "Power", color: "#ef4444" },
  { id: "speed", label: "Speed", color: "#22c55e" },
  { id: "soc", label: "SOC", color: "#facc15" },
];

function validNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isChargingTelemetry(telemetry: BydmateTelemetry) {
  const chargePowerKw = validNumber(telemetry.charge_power_kw);
  return telemetry.is_charging === true || (chargePowerKw != null && chargePowerKw > 0.1);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function validTempNumber(value: number | null | undefined) {
  const n = validNumber(value);
  return n != null && n >= -50 && n <= 90 ? n : null;
}

type WeightedConsumption = {
  value: number;
  weight: number;
};

type RangeEstimate = {
  estimatedRangeKm: number | null;
  consumptionKwh100Km: number | null;
};

function estimateVehicleRangeKm(
  snapshot: BydmateLiveSnapshotRow,
  recentTrips: BydmateTripRow[],
): RangeEstimate {
  const telemetry = snapshot.telemetry;
  const soc = validNumber(telemetry.soc);
  if (soc == null) return { estimatedRangeKm: null, consumptionKwh100Km: null };

  const soh = validNumber(telemetry.soh_percent);
  const usableBatteryKwh = DEFAULT_USABLE_BATTERY_KWH * (soh != null ? clamp(soh, 70, 105) / 100 : 1);
  const usableEnergyKwh = usableBatteryKwh * (clamp(soc, 0, 100) / 100);
  const consumptionKwh100Km = estimateConsumptionKwh100Km(snapshot, recentTrips);

  if (consumptionKwh100Km == null || consumptionKwh100Km <= 0) {
    return { estimatedRangeKm: null, consumptionKwh100Km: null };
  }

  return {
    estimatedRangeKm: (usableEnergyKwh / consumptionKwh100Km) * 100,
    consumptionKwh100Km,
  };
}

function estimateConsumptionKwh100Km(
  snapshot: BydmateLiveSnapshotRow,
  recentTrips: BydmateTripRow[],
) {
  const telemetry = snapshot.telemetry;
  const estimates: WeightedConsumption[] = [];

  const currentTripConsumption = validNumber(telemetry.current_trip_consumption_kwh_100km);
  const currentTripDistance = validNumber(telemetry.current_trip_distance_km);
  if (
    !isChargingTelemetry(telemetry) &&
    currentTripConsumption != null &&
    currentTripConsumption >= MIN_FORECAST_CONSUMPTION_KWH_100KM &&
    currentTripConsumption <= MAX_FORECAST_CONSUMPTION_KWH_100KM
  ) {
    estimates.push({
      value: currentTripConsumption,
      weight: currentTripDistance != null ? clamp(currentTripDistance / 12, 0.25, 1.8) : 0.7,
    });
  }

  const tripAverage = averageTripConsumption(
    recentTrips.filter((trip) => {
      const consumption = validNumber(trip.avg_consumption_kwh_100km);
      const distance = validNumber(trip.distance_km);
      return (
        consumption != null &&
        consumption >= MIN_FORECAST_CONSUMPTION_KWH_100KM &&
        consumption <= MAX_FORECAST_CONSUMPTION_KWH_100KM &&
        distance != null &&
        distance >= 1 &&
        trip.sample_count >= 3
      );
    }),
  );
  if (tripAverage != null) {
    estimates.push({ value: tripAverage, weight: 1.2 });
  }

  const speedKmh = validNumber(telemetry.speed_kmh);
  const powerKw = validNumber(telemetry.power_kw);
  if (speedKmh != null && speedKmh >= 12 && powerKw != null && powerKw > 0) {
    estimates.push({
      value: clamp((powerKw / speedKmh) * 100, MIN_FORECAST_CONSUMPTION_KWH_100KM, MAX_FORECAST_CONSUMPTION_KWH_100KM),
      weight: speedKmh >= 35 ? 0.9 : 0.45,
    });
  }

  const reportedRangeKm = validNumber(telemetry.range_est_km);
  const soc = validNumber(telemetry.soc);
  if (reportedRangeKm != null && reportedRangeKm > 10 && soc != null && soc > 2) {
    const reportedConsumption = ((DEFAULT_USABLE_BATTERY_KWH * (soc / 100)) / reportedRangeKm) * 100;
    if (
      reportedConsumption >= MIN_FORECAST_CONSUMPTION_KWH_100KM &&
      reportedConsumption <= MAX_FORECAST_CONSUMPTION_KWH_100KM
    ) {
      estimates.push({ value: reportedConsumption, weight: 0.35 });
    }
  }

  if (estimates.length === 0) {
    estimates.push({ value: DEFAULT_CONSUMPTION_KWH_100KM, weight: 1 });
  }

  const weightedConsumption =
    estimates.reduce((sum, estimate) => sum + estimate.value * estimate.weight, 0) /
    estimates.reduce((sum, estimate) => sum + estimate.weight, 0);

  return clamp(
    weightedConsumption * environmentConsumptionFactor(snapshot),
    MIN_FORECAST_CONSUMPTION_KWH_100KM,
    MAX_FORECAST_CONSUMPTION_KWH_100KM,
  );
}

function environmentConsumptionFactor(snapshot: BydmateLiveSnapshotRow) {
  const telemetry = snapshot.telemetry;
  let factor = 1;

  const outsideTemp = validTempNumber(telemetry.outside_temp_c);
  const batteryTemp =
    validTempNumber(telemetry.battery_temp_c) ?? validTempNumber(snapshot.diplus?.avg_battery_temp_c);
  const speedKmh = validNumber(telemetry.speed_kmh);

  if (outsideTemp != null) {
    if (outsideTemp < -10) factor += 0.28;
    else if (outsideTemp < 0) factor += 0.18;
    else if (outsideTemp < 8) factor += 0.08;
    else if (outsideTemp > 30) factor += 0.05;
  }

  if (batteryTemp != null) {
    if (batteryTemp < 5) factor += 0.12;
    else if (batteryTemp < 12) factor += 0.05;
    else if (batteryTemp > 42) factor += 0.04;
  }

  if (speedKmh != null) {
    if (speedKmh > 115) factor += 0.16;
    else if (speedKmh > 95) factor += 0.08;
    else if (speedKmh > 75) factor += 0.03;
  }

  if (snapshot.diplus?.ac_status === 1 || snapshot.diplus?.ac_status === true) {
    factor += outsideTemp != null && (outsideTemp < 8 || outsideTemp > 27) ? 0.08 : 0.03;
  }

  const tirePressures = [
    snapshot.diplus?.tire_press_fl_kpa,
    snapshot.diplus?.tire_press_fr_kpa,
    snapshot.diplus?.tire_press_rl_kpa,
    snapshot.diplus?.tire_press_rr_kpa,
  ]
    .map(validNumber)
    .filter((value): value is number => value != null && value > 100);
  if (tirePressures.length > 0) {
    const avgPressure = tirePressures.reduce((sum, value) => sum + value, 0) / tirePressures.length;
    if (avgPressure < 220) factor += 0.05;
  }

  return clamp(factor, 0.9, 1.45);
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
  location?: BydmateLocation;
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
    .filter((point) => pointTimeMs(point) > 0 && !isChargingTelemetry(point.telemetry))
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

  return groups.map((tripPoints, index) => {
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
    const distanceKm =
      odometerDistance != null && odometerDistance >= 0
        ? odometerDistance
        : tripDistance != null && tripDistance >= 0
          ? tripDistance
          : null;

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

function averageTripConsumption(trips: BydmateTripRow[]) {
  let weightedConsumption = 0;
  let weightedDistance = 0;
  let sampleConsumption = 0;
  let sampleCount = 0;

  for (const trip of trips) {
    const consumption = trip.avg_consumption_kwh_100km;
    if (consumption == null) continue;

    sampleConsumption += consumption;
    sampleCount += 1;

    const distance = trip.distance_km;
    if (distance != null && distance > 0) {
      weightedConsumption += consumption * distance;
      weightedDistance += distance;
    }
  }

  if (weightedDistance > 0) return weightedConsumption / weightedDistance;
  return sampleCount > 0 ? sampleConsumption / sampleCount : null;
}

function ExpandedTripPanel({ tripId }: { tripId: string }) {
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

  return (
    <>
      <TelemetryHistoryCharts
        points={samples}
        isLoading={isSamplesLoading}
        hasError={Boolean(samplesError)}
        embedded
      />
      <RouteMap trackPoints={track} isLoading={isTrackLoading} hasError={Boolean(trackError)} embedded />
    </>
  );
}

function TripBrowser({
  selectedDate,
  availableDateKeys = [],
  onDateChange,
  trips,
  selectedTripId,
  onSelectTrip,
  isLoading,
  hasError,
  expandedFixtureTrip,
}: {
  selectedDate: string;
  availableDateKeys?: string[];
  onDateChange: (value: string) => void;
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
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight">
            {tx("vehicle.trips.title")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {tx("vehicle.trips.subtitle")}
          </p>
        </div>
        <label className="grid gap-1 text-sm text-muted-foreground">
          {tx("vehicle.trips.date")}
          <Input
            type="date"
            value={selectedDate}
            onChange={(event) => onDateChange(event.target.value)}
            className="w-44"
          />
        </label>
      </div>

      {availableDateKeys.length > 0 ? (
        <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
          {availableDateKeys.slice(0, 14).map((dateKey) => {
            const selected = dateKey === selectedDate;
            const date = new Date(`${dateKey}T12:00:00`);
            return (
              <button
                key={dateKey}
                type="button"
                onClick={() => onDateChange(dateKey)}
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

      <div className="mt-5 grid grid-cols-2 gap-3 min-[430px]:grid-cols-4">
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
                    <ExpandedTripPanel tripId={trip.id} />
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
  const { t } = useTranslation();
  const tx = t as Translator;

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
      </div>
    </button>
  );
}

function SummaryPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-white/[0.02] p-3">
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-1 font-heading text-lg font-semibold tabular-nums">{value}</p>
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

function createChart(
  title: string,
  unit: string,
  series: ChartSeries[],
  valueDigits = 1,
): TelemetryChart {
  return {
    title,
    unit,
    valueDigits,
    series,
    minValue: 0,
    maxValue: 1,
    minTime: 0,
    maxTime: 1,
    hasData: false,
  };
}

function addChartPoint(chart: TelemetryChart, seriesIndex: number, time: number, value: number | null) {
  if (value == null || !Number.isFinite(time)) return;

  chart.series[seriesIndex].points.push({ time, value });
  chart.minValue = chart.hasData ? Math.min(chart.minValue, value) : value;
  chart.maxValue = chart.hasData ? Math.max(chart.maxValue, value) : value;
  chart.minTime = chart.hasData ? Math.min(chart.minTime, time) : time;
  chart.maxTime = chart.hasData ? Math.max(chart.maxTime, time) : time;
  chart.hasData = true;
}

function addChartPointWithPower(
  chart: TelemetryChart,
  seriesIndex: number,
  time: number,
  value: number | null,
  powerKw: number | null,
) {
  if (value == null || !Number.isFinite(time)) return;

  chart.series[seriesIndex].points.push({ time, value, powerKw });
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

function prepareTelemetryHistory(points: TelemetryChartSource[], t: Translator) {
  const socChart = createChart(t("vehicle.charts.soc"), "%", [
    { label: "SOC", color: "var(--voltflow-cyan)", points: [] },
  ]);
  const speedChart = createChart(t("vehicle.metrics.speed"), "km/h", [
    { label: t("vehicle.metrics.speed"), color: "#7dd3fc", points: [] },
  ]);
  const powerChart = createChart(t("vehicle.metrics.power"), "kW", [
    { label: t("vehicle.metrics.power"), color: "#facc15", points: [] },
  ]);
  const regenChart = createChart(t("vehicle.charts.regen"), "kWh", [
    { label: t("vehicle.trips.regen"), color: "#34d399", points: [] },
  ], 2);
  const temperatureChart = createChart(t("vehicle.charts.temperatures"), "°C", [
    { label: t("vehicle.charts.battery"), color: "#22c55e", points: [] },
    { label: t("vehicle.charts.outside"), color: "#38bdf8", points: [] },
    { label: t("vehicle.charts.cabin"), color: "#fb7185", points: [] },
  ]);
  const cellDeltaChart = createChart(t("vehicle.charts.cellDelta"), "V", [
    { label: "Delta", color: "#fb7185", points: [] },
  ], 3);
  const deltaBySocPoints: DeltaBySocPoint[] = [];

  let visiblePointCount = 0;
  let start: string | undefined;
  let end: string | undefined;

  for (const point of points) {
    if (!point.telemetry) continue;

    visiblePointCount += 1;
    start ??= point.device_time;
    end = point.device_time;

    const time = pointTimeMs(point);
    const soc = validNumber(point.telemetry.soc);
    const cellDelta = cellDeltaValue(point);
    addChartPoint(socChart, 0, time, soc);
    addChartPoint(speedChart, 0, time, validNumber(point.telemetry.speed_kmh));
    addChartPoint(powerChart, 0, time, validNumber(point.telemetry.power_kw));
    addChartPoint(temperatureChart, 0, time, validTempNumber(point.telemetry.battery_temp_c));
    addChartPoint(temperatureChart, 1, time, validTempNumber(point.telemetry.outside_temp_c));
    addChartPoint(temperatureChart, 2, time, validTempNumber(point.telemetry.cabin_temp_c));
    addChartPoint(cellDeltaChart, 0, time, cellDelta);
    addDeltaBySocPoint(deltaBySocPoints, time, soc, cellDelta);
  }

  for (const point of calculateCumulativeRegenPoints(points.map((sample) => ({
    device_time: sample.device_time,
    power_kw: sample.telemetry?.power_kw,
  })))) {
    addChartPointWithPower(regenChart, 0, point.time, point.value, point.power_kw);
  }

  const charts = [socChart, speedChart, powerChart, regenChart, temperatureChart, cellDeltaChart].map((chart) => ({
    ...chart,
    series: chart.series.map((series) => ({
      ...series,
      points: downsamplePoints(series.points, MAX_CHART_POINTS),
    })),
  }));

  return {
    visiblePointCount,
    start,
    end,
    charts,
    deltaBySoc: prepareDeltaBySoc(deltaBySocPoints, "discharge"),
  };
}

export function TelemetryHistoryCharts({
  points,
  isLoading,
  hasError,
  embedded = false,
}: {
  points: TelemetryChartSource[];
  isLoading: boolean;
  hasError: boolean;
  embedded?: boolean;
}) {
  const { locale, t } = useTranslation();
  const tx = t as Translator;
  const history = useMemo(() => prepareTelemetryHistory(points, tx), [points, tx]);

  return (
    <section className={embedded ? "rounded-2xl border border-border bg-white/[0.02] p-4" : "voltflow-card p-5"}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight">
            {tx("vehicle.charts.title")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {tx("vehicle.charts.cloudPoints", { value: history.visiblePointCount })}
            {history.start && history.end ? ` · ${new Date(history.start).toLocaleTimeString(localeCode(locale))} - ${new Date(history.end).toLocaleTimeString(localeCode(locale))}` : ""}
          </p>
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
      ) : history.visiblePointCount === 0 ? (
        <p className="mt-5 rounded-2xl border border-border bg-white/[0.03] p-4 text-sm text-muted-foreground">
          {tx("vehicle.charts.empty")}
        </p>
      ) : (
        <>
          {history.visiblePointCount < 2 ? (
            <p className="mt-5 rounded-2xl border border-primary/20 bg-primary/10 p-4 text-sm text-primary">
              {tx("vehicle.charts.onePoint")}
            </p>
          ) : null}
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {history.charts.map((chart) => (
              <TelemetryLineChart
                key={chart.title}
                chart={chart}
              />
            ))}
          </div>
          <DeltaBySocChart chart={history.deltaBySoc} />
        </>
      )}
    </section>
  );
}

function TelemetryLineChart({ chart }: { chart: TelemetryChart }) {
  const { t } = useTranslation();
  const tx = t as Translator;
  const { title, unit, valueDigits, series, hasData, minValue, maxValue, minTime, maxTime } = chart;
  const valuePad = Math.max((maxValue - minValue) * 0.12, maxValue === minValue ? 1 : 0);
  const yMin = minValue - valuePad;
  const yMax = maxValue + valuePad;

  const x = (time: number) => {
    if (maxTime === minTime) return 160;
    return 34 + ((time - minTime) / (maxTime - minTime)) * 284;
  };
  const y = (value: number) => {
    if (yMax === yMin) return 60;
    return 104 - ((value - yMin) / (yMax - yMin)) * 88;
  };
  const startTime = Number.isFinite(minTime) ? minTime : 0;
  const xTicks = hasData
    ? [
        { label: new Date(minTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), time: minTime },
        {
          label: new Date(minTime + (maxTime - minTime) / 2).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          time: minTime + (maxTime - minTime) / 2,
        },
        { label: new Date(maxTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), time: maxTime },
      ]
    : [];
  const yTicks = hasData
    ? [
        { label: fmt(maxValue, valueDigits), value: maxValue },
        { label: fmt((minValue + maxValue) / 2, valueDigits), value: (minValue + maxValue) / 2 },
        { label: fmt(minValue, valueDigits), value: minValue },
      ]
    : [];

  const pointTitle = (item: ChartSeries, point: ChartPoint) => {
    const elapsedMin = Math.max(0, Math.round((point.time - startTime) / 60000));
    const clock = new Date(point.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const power = point.powerKw == null ? "" : `\n${tx("vehicle.metrics.power")}: ${fmt(point.powerKw, 1)} kW`;
    return `${item.label}: ${fmt(point.value, valueDigits)} ${unit}\n${elapsedMin}m · ${clock}${power}`;
  };

  return (
    <article className="rounded-2xl border border-border bg-white/[0.02] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-heading text-lg font-semibold tracking-tight">{title}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {hasData ? `${fmt(minValue, valueDigits)}-${fmt(maxValue, valueDigits)} ${unit}` : tx("vehicle.charts.noValues")}
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {series.map((item) => (
            <span key={item.label} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="size-2 rounded-full" style={{ backgroundColor: item.color }} />
              {item.label}
            </span>
          ))}
        </div>
      </div>

      <svg className="mt-4 h-44 w-full overflow-visible" viewBox="0 0 340 158" role="img" aria-label={tx("vehicle.charts.chartAria", { title })}>
        <line x1="34" x2="318" y1="104" y2="104" stroke="currentColor" className="text-border" strokeWidth="1" />
        <line x1="34" x2="34" y1="16" y2="104" stroke="currentColor" className="text-border" strokeWidth="1" />
        {yTicks.map((tick) => (
          <g key={`${title}-y-${tick.label}`}>
            <line x1="34" x2="318" y1={y(tick.value)} y2={y(tick.value)} stroke="currentColor" className="text-border/60" strokeWidth="1" strokeDasharray="4 6" />
            <text x="29" y={y(tick.value) + 3} textAnchor="end" className="fill-muted-foreground text-[9px]">
              {tick.label}
            </text>
          </g>
        ))}
        {xTicks.map((tick) => (
          <g key={`${title}-x-${tick.label}`}>
            <line x1={x(tick.time)} x2={x(tick.time)} y1="104" y2="109" stroke="currentColor" className="text-border" strokeWidth="1" />
            <text x={x(tick.time)} y="124" textAnchor="middle" className="fill-muted-foreground text-[9px]">
              {tick.label}
            </text>
          </g>
        ))}
        <text x="176" y="148" textAnchor="middle" className="fill-muted-foreground text-[9px]">
          {tx("vehicle.charts.elapsed")}
        </text>
        <text x="6" y="60" textAnchor="middle" transform="rotate(-90 6 60)" className="fill-muted-foreground text-[9px]">
          {unit}
        </text>
        {series.map((item) => {
          const d = item.points
            .map((point, index) => `${index === 0 ? "M" : "L"} ${x(point.time).toFixed(2)} ${y(point.value).toFixed(2)}`)
            .join(" ");
          const markers = item.points.length <= MAX_CHART_MARKERS ? item.points : [];
          return (
            <g key={item.label}>
              {item.points.length > 1 ? (
                <path d={d} fill="none" stroke={item.color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              ) : null}
              {item.points.map((point, index) => (
                <circle
                  key={`${item.label}-hit-${point.time}-${index}`}
                  cx={x(point.time)}
                  cy={y(point.value)}
                  r="7"
                  fill="transparent"
                >
                  <title>{pointTitle(item, point)}</title>
                </circle>
              ))}
              {markers.map((point, index) => (
                <circle key={`${item.label}-${point.time}-${index}`} cx={x(point.time)} cy={y(point.value)} r="3.5" fill={item.color}>
                  <title>{pointTitle(item, point)}</title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>
    </article>
  );
}

function DeltaBySocChart({ chart }: { chart: DeltaBySocChartModel }) {
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
        <DeltaBySocPlot chart={chart} zoom={0} heightClassName="h-44" />
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

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
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
            <DeltaBySocPlot chart={chart} zoom={zoom} heightClassName="h-full min-h-[22rem]" />
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
}: {
  chart: DeltaBySocChartModel;
  zoom: number;
  heightClassName: string;
}) {
  const { t } = useTranslation();
  const tx = t as Translator;
  const clipId = useId();
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
  const linePath = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${x(point.time).toFixed(2)} ${y(point.delta).toFixed(2)}`)
    .join(" ");
  const socPath = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${x(point.time).toFixed(2)} ${socY(point.soc).toFixed(2)}`)
    .join(" ");
  const markerPoints = points.length <= MAX_CHART_MARKERS ? points : [];

  return (
    <div className="rounded-2xl border border-border bg-background/30 p-3">
      <svg className={`${heightClassName} w-full overflow-hidden`} viewBox="0 0 320 142" role="img" aria-label={tx("vehicle.charts.deltaBySoc")}>
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
          {points.length > 1 ? (
            <path d={socPath} fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.78" strokeDasharray="3 5" />
          ) : null}
          {points.length > 1 ? (
            <path d={linePath} fill="none" stroke="#38bdf8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.78" />
          ) : null}
          {markerPoints.map((point, index) => {
            const isLatest = point === latest;
            return (
              <circle
                key={`${point.time}-${index}`}
                cx={x(point.time)}
                cy={y(point.delta)}
                r={isLatest ? 4 : 3}
                fill={isLatest ? "#facc15" : "#fb7185"}
                opacity={isLatest ? 1 : 0.78}
              />
            );
          })}
        </g>
      </svg>
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
    if (bounds.width <= 288 && bounds.height <= 132) {
      return zoom;
    }
  }

  return MIN_MAP_ZOOM;
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
      x: 16 + ((projected.x - topLeftX - 16) / (MAP_VIEW_WIDTH - 32)) * (MAP_VIEW_WIDTH - 32),
      y: 8 + ((projected.y - topLeftY - 8) / (MAP_VIEW_HEIGHT - 24)) * (MAP_VIEW_HEIGHT - 24),
    };
  };

  return {
    zoom,
    tiles,
    mapPoint,
  };
}

function routeLayerValue(point: RoutePoint, layer: RouteLayer) {
  if (layer === "regen") return point.powerKw == null ? null : Math.max(0, -point.powerKw);
  if (layer === "power") return point.powerKw == null ? null : Math.abs(point.powerKw);
  if (layer === "speed") return point.speedKmh;
  if (layer === "soc") return point.soc;
  return null;
}

function routeLayerColor(layer: RouteLayer) {
  return ROUTE_LAYER_OPTIONS.find((option) => option.id === layer)?.color ?? "var(--voltflow-cyan)";
}

function routeLayerSegmentColor(layer: RouteLayer, normalized: number) {
  const intensity = Math.max(0, Math.min(1, normalized));

  if (layer === "power") {
    return `hsl(0 84% ${34 + intensity * 30}%)`;
  }

  if (layer === "regen") {
    return `hsl(158 72% ${30 + intensity * 34}%)`;
  }

  if (layer === "speed") {
    return `hsl(142 72% ${30 + intensity * 30}%)`;
  }

  if (layer === "soc") {
    return `hsl(48 96% ${28 + intensity * 34}%)`;
  }

  return routeLayerColor(layer);
}

function buildRouteSegments(
  route: ReturnType<typeof prepareRoute>,
  routeMap: ReturnType<typeof prepareRouteMap>,
  selectedLayer: RouteLayer,
) {
  if (route.points.length < 2) return [];

  const values =
    selectedLayer === "route"
      ? []
      : route.points
          .map((point) => routeLayerValue(point, selectedLayer))
          .filter((value): value is number => value != null);
  const minValue = values.length ? Math.min(...values) : 0;
  const maxValue = values.length ? Math.max(...values) : 1;

  return route.points.slice(1).map((point, index): RouteSegment => {
    const previous = route.points[index];
    const mappedPrevious = routeMap.mapPoint(previous);
    const mappedPoint = routeMap.mapPoint(point);
    const value = routeLayerValue(point, selectedLayer);
    const normalized =
      value == null || maxValue === minValue ? 1 : (value - minValue) / (maxValue - minValue);
    const hasRegen = selectedLayer === "regen" && value != null && value > 0;

    return {
      key: `${selectedLayer}-${previous.time}-${point.time}-${index}`,
      path: `M ${mappedPrevious.x.toFixed(2)} ${mappedPrevious.y.toFixed(2)} L ${mappedPoint.x.toFixed(2)} ${mappedPoint.y.toFixed(2)}`,
      color:
        selectedLayer === "regen" && !hasRegen
          ? "var(--voltflow-cyan)"
          : routeLayerSegmentColor(selectedLayer, normalized),
      opacity:
        selectedLayer === "regen"
          ? hasRegen ? 1 : 0.22
          : value == null ? 0.35 : 1,
      title: `${formatClock(point.time)} · ${point.powerKw == null ? "—" : `${fmt(point.powerKw, 1)} kW`}`,
      dash: hasRegen ? "7 5" : undefined,
    };
  });
}

export function RouteMap({
  points,
  trackPoints,
  isLoading = false,
  hasError = false,
  embedded = false,
}: {
  points?: BydmateTelemetryPointRow[];
  trackPoints?: BydmateTripTrackPointRow[];
  isLoading?: boolean;
  hasError?: boolean;
  embedded?: boolean;
}) {
  const { t } = useTranslation();
  const tx = t as Translator;
  const route = useMemo(() => {
    if (trackPoints) return prepareRouteFromTrack(trackPoints);
    return prepareRoute(points ?? []);
  }, [points, trackPoints]);
  const start = route.start;
  const end = route.end;
  const [zoomOffset, setZoomOffset] = useState(0);
  const [pan, setPan] = useState<MapPan>({ x: 0, y: 0 });
  const [isFullscreenOpen, setIsFullscreenOpen] = useState(false);
  const [selectedLayer, setSelectedLayer] = useState<RouteLayer>("regen");

  const zoomIn = () => setZoomOffset((value) => Math.min(MAX_MAP_ZOOM_OFFSET, value + 1));
  const zoomOut = () => setZoomOffset((value) => Math.max(MIN_MAP_ZOOM_OFFSET, value - 1));
  const resetView = () => {
    setZoomOffset(0);
    setPan({ x: 0, y: 0 });
  };

  return (
    <section className={embedded ? "rounded-2xl border border-border bg-white/[0.02] p-4" : "voltflow-card p-5"}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight">
            {tx("vehicle.route.title")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {tx("vehicle.route.gpsPoints", { value: route.totalPoints })}
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
          <div className="grid grid-cols-2 gap-3 border-t border-border p-4 text-sm">
            <MiniStat label={tx("vehicle.route.start")} value={start ? `${start.lat.toFixed(5)}, ${start.lon.toFixed(5)}` : "—"} />
            <MiniStat label={tx("vehicle.route.end")} value={end ? `${end.lat.toFixed(5)}, ${end.lon.toFixed(5)}` : "—"} />
          </div>
          <Dialog open={isFullscreenOpen} onOpenChange={setIsFullscreenOpen}>
            <DialogContent className="h-[calc(100dvh-1rem)] max-w-[calc(100vw-1rem)] gap-3 p-3 sm:max-w-[calc(100vw-2rem)]">
              <DialogTitle className="sr-only">{tx("vehicle.route.dialogTitle")}</DialogTitle>
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
}) {
  const { t } = useTranslation();
  const tx = t as Translator;
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const routeMap = useMemo(() => prepareRouteMap(route, zoomOffset, pan), [pan, route, zoomOffset]);
  const routeSegments = useMemo(
    () => buildRouteSegments(route, routeMap, selectedLayer),
    [route, routeMap, selectedLayer],
  );
  const mappedStart = route.start ? routeMap.mapPoint(route.start) : null;
  const mappedEnd = route.end ? routeMap.mapPoint(route.end) : null;

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
      <div className="absolute left-2 top-2 z-10 grid w-[10rem] grid-cols-2 gap-1 rounded-2xl border border-border bg-background/85 p-1 shadow-sm backdrop-blur sm:left-3 sm:top-3 sm:w-auto sm:grid-cols-5 sm:rounded-full">
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
              <span className="size-1.5 shrink-0 rounded-full sm:size-2" style={{ backgroundColor: option.color }} />
              <span className="truncate">{shortLabel}</span>
            </button>
          );
        })}
      </div>
      <div className="absolute right-2 top-2 z-10 flex gap-1.5 sm:right-3 sm:top-3 sm:gap-2">
        <MapIconButton label={tx("vehicle.route.zoomIn")} onClick={onZoomIn}>
          <Plus className="size-4" aria-hidden />
        </MapIconButton>
        <MapIconButton label={tx("vehicle.route.zoomOut")} onClick={onZoomOut}>
          <Minus className="size-4" aria-hidden />
        </MapIconButton>
        <MapIconButton label={tx("vehicle.route.resetMap")} onClick={onResetView}>
          <MapPin className="size-4" aria-hidden />
        </MapIconButton>
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
      <svg
        className="size-full touch-none cursor-grab active:cursor-grabbing"
        viewBox="0 0 320 180"
        role="img"
        aria-label={tx("vehicle.route.aria")}
        onPointerDown={(event) => {
          dragRef.current = { x: event.clientX, y: event.clientY };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => dragMap(event.clientX, event.clientY, event.currentTarget)}
        onPointerUp={(event) => {
          dragRef.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          dragRef.current = null;
        }}
        onWheel={(event) => {
          event.preventDefault();
          if (event.deltaY < 0) {
            onZoomIn();
          } else if (event.deltaY > 0) {
            onZoomOut();
          }
        }}
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
        {routeSegments.length > 0 ? (
          routeSegments.map((segment) => (
            <path
              key={segment.key}
              d={segment.path}
              fill="none"
              stroke={segment.color}
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={segment.dash}
              opacity={segment.opacity}
              filter="url(#route-line-shadow)"
            >
              <title>{segment.title}</title>
            </path>
          ))
        ) : route.points.length > 1 ? (
          <path
            d={routeSegments.map((segment) => segment.path).join(" ")}
            fill="none"
            stroke={routeLayerColor(selectedLayer)}
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
            filter="url(#route-line-shadow)"
          />
        ) : null}
        {mappedStart ? (
          <circle cx={mappedStart.x} cy={mappedStart.y} r="5" fill="#22c55e" stroke="rgba(0,0,0,0.55)" strokeWidth="2">
            <title>{tx("vehicle.route.start")}</title>
          </circle>
        ) : null}
        {mappedEnd ? (
          <circle cx={mappedEnd.x} cy={mappedEnd.y} r="5" fill="#facc15" stroke="rgba(0,0,0,0.55)" strokeWidth="2">
            <title>{tx("vehicle.route.end")}</title>
          </circle>
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

function LocationCard({ snapshot }: { snapshot: BydmateLiveSnapshotRow }) {
  const { locale, t } = useTranslation();
  const tx = t as Translator;
  const loc = snapshot.location;
  const hasLocation = typeof loc.lat === "number" && typeof loc.lon === "number";

  return (
    <Card className="voltflow-card border-border bg-transparent">
      <CardHeader>
        <CardTitle className="flex items-center gap-3 text-xl tracking-tight">
          <MapPin className="size-5 text-primary" aria-hidden />
          {tx("vehicle.location.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-base">
        {hasLocation ? (
          <>
            <Row label={tx("vehicle.location.latitude")} value={fmt(loc.lat, 6)} />
            <Row label={tx("vehicle.location.longitude")} value={fmt(loc.lon, 6)} />
            <Row label={tx("vehicle.location.accuracy")} value={`${fmt(loc.accuracy_m, 1)} m`} />
            <Row label={tx("vehicle.location.bearing")} value={`${fmt(loc.bearing_deg, 0)}°`} />
          </>
        ) : (
          <p className="text-muted-foreground">
            {tx("vehicle.location.empty")}
          </p>
        )}
        <Row label={tx("vehicle.location.deviceTime")} value={new Date(snapshot.device_time).toLocaleString(localeCode(locale))} />
        <Row label={tx("vehicle.location.received")} value={new Date(snapshot.received_at).toLocaleString(localeCode(locale))} />
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-border py-3 first:border-t-0 first:pt-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-heading font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function EmptyVehicleState() {
  const { t } = useTranslation();
  const tx = t as Translator;

  return (
    <div className="safe-bottom flex flex-col gap-5 px-4 pb-6 pt-5">
      <Header />
      <section className="voltflow-card p-6">
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
