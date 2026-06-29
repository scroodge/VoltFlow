"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BatteryCharging, CarFront, Route } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { startChargingSession, stopChargingSession } from "@/actions/sessions";
import { BrandBadge } from "@/components/brand/BrandBadge";
import { ChargingBolt } from "@/components/brand/ChargingBolt";
import { LogoFull } from "@/components/brand/LogoFull";
import {
  useDashboardDevSnapshot,
  useDashboardDevSnapshotOverride,
} from "@/components/dev/dashboard-dev-snapshot-context";
import { BatteryRing } from "@/components/charging/BatteryRing";
import { ChargingActionButton } from "@/components/charging/ChargingActionButton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useBydmateLiveQuery } from "@/hooks/use-bydmate-live-query";
import { useLatestBydmateTripsQuery } from "@/hooks/use-bydmate-trips-query";
import { useCarsQuery } from "@/hooks/use-cars-query";
import { usePageVisible } from "@/hooks/use-page-visible";
import { chargingSessionsRefetchInterval, fetchSessions } from "@/hooks/use-sessions-query";
import { useTickingClock } from "@/hooks/use-ticking-clock";
import { useTranslation } from "@/hooks/use-translation";
import {
  availableBatteryKwh,
  chargingHoursFromEnergy,
  costFromGridEnergy,
  energyFromGridKwh,
  energyNeededKwh,
  formatDuration,
} from "@/lib/charging-math";
import { useVehicleRangeEstimate } from "@/hooks/use-vehicle-range-estimate";
import { resolveTariffLocationMatch } from "@/lib/charging-gps-location";
import {
  chargingParamsFromSession,
  deriveChargingSessionLiveBundle,
  filterLiveSnapshotsForVehicle,
} from "@/lib/charging-session-sync";
import { resolveDisplayChargePowerKw, snapshotSoc } from "@/lib/charging-live";
import { mapChargingTariffLocation } from "@/lib/db-map";
import { isDevAppRoute } from "@/lib/dev/dev-fetch";
import { useAppPath } from "@/lib/dev/dev-path";
import { currencySymbols, formatCurrencyAmount, type Currency, type Locale, type TranslationKey } from "@/lib/i18n";
import { parseDecimalInput } from "@/lib/number-input";
import { PROVIDER_LABELS, resolveTariffPrice } from "@/lib/charging-tariffs";
import { ensureNotificationsPermission, ensurePushSubscription } from "@/lib/push/client";
import { queryKeys } from "@/lib/query-keys";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  canStartChargingSession,
  dashboardVehicleStatusLabelKey,
  deriveDashboardVehicleMode,
  resolveLiveSnapshotForVehicle,
  type DashboardVehicleMode,
} from "@/lib/vehicle-live-mode";
import { useAppPreferences } from "@/stores/use-app-preferences";
import type {
  BydmateLiveSnapshotRow,
  BydmateTripRow,
  ChargingProviderType,
  ChargingSessionRow,
  ChargingTariffType,
} from "@/types/database";

const CHARGE_TYPE_OPTIONS: { value: ChargingTariffType; labelKey: TranslationKey }[] = [
  { value: "home", labelKey: "dashboard.estimateTypeHome" },
  { value: "commercial_ac", labelKey: "dashboard.estimateTypeAc" },
  { value: "fast_dc", labelKey: "dashboard.estimateTypeDc" },
];

const PROVIDER_OPTIONS: { value: ChargingProviderType; label: string }[] = [
  { value: "custom", label: PROVIDER_LABELS.custom },
  { value: "home", label: PROVIDER_LABELS.home },
  { value: "malanka", label: PROVIDER_LABELS.malanka },
  { value: "evika", label: PROVIDER_LABELS.evika },
  { value: "forevo", label: PROVIDER_LABELS.forevo },
  { value: "zaryadka", label: PROVIDER_LABELS.zaryadka },
];

function defaultEstimatePowerKw(type: ChargingTariffType, homePowerKw?: number | null) {
  if (type === "fast_dc") return 65;
  if (type === "commercial_ac") return 7;
  // Home charging defaults to the user's per-car configured charger power.
  return typeof homePowerKw === "number" && homePowerKw > 0 ? homePowerKw : 4.4;
}

function cappedPositivePowerKw(powerKw: number, capKw: number) {
  return Math.max(1, Math.min(powerKw, capKw));
}

function chargingSecondsToFull({
  batteryCapacityKwh,
  currentPercent,
  efficiencyPercent,
  powerKw,
  tariffType,
}: {
  batteryCapacityKwh: number;
  currentPercent: number;
  efficiencyPercent: number;
  powerKw: number;
  tariffType: ChargingTariffType;
}) {
  if (tariffType !== "fast_dc") {
    return (
      chargingHoursFromEnergy(
        energyFromGridKwh(
          energyNeededKwh(batteryCapacityKwh, currentPercent, 100),
          efficiencyPercent,
        ),
        powerKw,
      ) * 3600
    );
  }

  const bands = [
    { toPercent: 70, powerKw },
    { toPercent: 90, powerKw: cappedPositivePowerKw(powerKw, 45) },
    { toPercent: 95, powerKw: cappedPositivePowerKw(powerKw, 25) },
    { toPercent: 100, powerKw: cappedPositivePowerKw(powerKw, 15) },
  ];

  let fromPercent = currentPercent;
  let seconds = 0;
  for (const band of bands) {
    if (fromPercent >= band.toPercent) continue;
    const toPercent = Math.min(100, band.toPercent);
    const segmentEnergyKwh = energyFromGridKwh(
      energyNeededKwh(batteryCapacityKwh, fromPercent, toPercent),
      efficiencyPercent,
    );
    seconds += chargingHoursFromEnergy(segmentEnergyKwh, band.powerKw) * 3600;
    fromPercent = toPercent;
  }
  return seconds;
}

function liveStartPercent(snapshot: BydmateLiveSnapshotRow | null | undefined) {
  const soc = snapshotSoc(snapshot);
  if (soc == null || soc >= 100) return null;
  return String(Math.round(soc));
}

function localeCode(locale: string) {
  return locale === "be" ? "be-BY" : locale === "ru" ? "ru-RU" : "en-US";
}

function fmt(value: number | null | undefined, digits = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "—";
}

function formatClockRange(startIso: string | null, endIso: string | null, locale: string) {
  if (!startIso) return "—";
  const code = localeCode(locale);
  const start = new Date(startIso);
  const end = endIso ? new Date(endIso) : null;
  const date = start.toLocaleDateString(code, { day: "numeric", month: "short" });
  const startTime = start.toLocaleTimeString(code, { hour: "2-digit", minute: "2-digit" });
  const endTime = end?.toLocaleTimeString(code, { hour: "2-digit", minute: "2-digit" });
  return endTime ? `${date}, ${startTime} - ${endTime}` : `${date}, ${startTime}`;
}

function durationBetween(startIso: string | null, endIso: string | null) {
  if (!startIso || !endIso) return "—";
  return formatDuration(Math.max(0, Math.round((Date.parse(endIso) - Date.parse(startIso)) / 1000)));
}

function tripSoc(trip: BydmateTripRow) {
  if (typeof trip.soc_start !== "number" || typeof trip.soc_end !== "number") return "—";
  return `${fmt(trip.soc_start)}% -> ${fmt(trip.soc_end)}%`;
}

function drivingStatsFromLive(
  snapshot: BydmateLiveSnapshotRow | null,
  trip: BydmateTripRow | null,
) {
  const telemetry = snapshot?.telemetry;
  const ongoingTrip = trip && !trip.ended_at ? trip : null;

  return {
    avgSpeedKmh: ongoingTrip?.avg_speed_kmh ?? telemetry?.speed_kmh ?? null,
    consumptionKwh100:
      telemetry?.current_trip_consumption_kwh_100km ??
      ongoingTrip?.avg_consumption_kwh_100km ??
      null,
    distanceKm:
      telemetry?.current_trip_distance_km ?? ongoingTrip?.distance_km ?? null,
    regenKwh: trip?.regen_energy_kwh ?? ongoingTrip?.regen_energy_kwh ?? null,
  };
}

function DashboardStatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-white/[0.03] p-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 font-heading text-base font-bold tabular-nums">{value}</p>
    </div>
  );
}

type DrivingStatAccent = "cyan" | "green" | "default";

function DrivingStatsGrid({
  items,
}: {
  items: {
    label: string;
    value: string;
    unit?: string;
    accent?: DrivingStatAccent;
  }[];
}) {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border/80 bg-border/80">
      {items.map((item) => (
        <div
          key={item.label}
          className="min-h-[4.25rem] bg-[#12151C]/90 px-3 py-2.5"
        >
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {item.label}
          </p>
          <p
            className={cn(
              "mt-1.5 flex items-baseline gap-1 font-heading font-bold tabular-nums leading-none",
              item.accent === "cyan" && "text-[var(--voltflow-cyan)]",
              item.accent === "green" && "text-[var(--voltflow-green)]",
              (!item.accent || item.accent === "default") && "text-foreground",
            )}
          >
            <span className="text-xl tracking-normal">{item.value}</span>
            {item.unit ? (
              <span className="text-[11px] font-semibold text-muted-foreground">{item.unit}</span>
            ) : null}
          </p>
        </div>
      ))}
    </div>
  );
}

function drivingStatParts(
  value: number | null | undefined,
  digits: number,
  unit: string,
): { value: string; unit?: string } {
  if (value == null || !Number.isFinite(value)) return { value: "—" };
  return { value: fmt(value, digits), unit };
}

function liveVehicleSummaryTitle(
  snapshot: BydmateLiveSnapshotRow | null,
  mode: DashboardVehicleMode,
  statusLabel: string,
  chargePowerKw: number | null,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
  formatNumber: (value: number | null | undefined, digits?: number) => string,
) {
  if (!snapshot) return t("dashboard.liveVehicleSpeed", { speed: "0" });

  const telemetry = snapshot.telemetry;
  if (mode === "app_charging" || mode === "live_charging") {
    return t("dashboard.liveVehicleCharging", {
      power: formatNumber(chargePowerKw, 1),
    });
  }
  if (mode === "driving") {
    return t("dashboard.liveVehicleSpeed", {
      speed: formatNumber(telemetry.speed_kmh, 0),
    });
  }
  if (mode === "stale") return statusLabel;

  return t("dashboard.liveVehicleSpeed", {
    speed: formatNumber(telemetry.speed_kmh, 0),
  });
}

function statusBadgeClass(mode: DashboardVehicleMode) {
  switch (mode) {
    case "app_charging":
    case "live_charging":
      return "text-[var(--voltflow-green)]";
    case "driving":
      return "text-[var(--voltflow-cyan)]";
    case "stale":
      return "text-muted-foreground";
    default:
      return "text-[var(--voltflow-green)]";
  }
}

function DashboardSummaryCard({
  href,
  icon,
  label,
  title,
  body,
  meta,
}: {
  href: string;
  icon: ReactNode;
  label: string;
  title: string;
  body: string;
  meta?: string;
}) {
  return (
    <Link
      href={href}
      className="grid min-h-[92px] grid-cols-[1fr_auto] items-center gap-3 rounded-2xl border border-border bg-white/[0.03] p-4 transition hover:border-primary/50 hover:bg-white/[0.05]"
    >
      <span className="min-w-0">
        <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </span>
        <span className="block font-heading text-lg font-bold tracking-normal text-foreground">
          {title}
        </span>
        <span className="mt-1 block text-sm leading-5 text-muted-foreground">{body}</span>
        {meta ? (
          <span className="mt-1 block truncate text-xs font-medium text-muted-foreground">
            {meta}
          </span>
        ) : null}
      </span>
      <span className="text-[var(--voltflow-cyan)]">{icon}</span>
    </Link>
  );
}

function RangeBadge({ value }: { value: string | null }) {
  if (!value) return null;

  return (
    <div className="absolute inset-x-0 bottom-0 z-10 mx-auto w-fit rounded-full border border-[var(--voltflow-cyan)]/35 bg-[#10151D]/95 px-3 py-1 font-heading text-sm font-bold tracking-normal text-[var(--voltflow-cyan)] shadow-[0_0_18px_rgba(0,209,255,0.18)] tabular-nums">
      {value}
    </div>
  );
}

function ParkChargeEstimatePanel({
  currency,
  estimatePowerKw,
  estimateProviderType,
  estimateTariffType,
  homeChargerPowerKw,
  locale,
  parkEstimate,
  setEstimatePowerKw,
  setEstimateProviderType,
  setEstimateTariffType,
  t,
}: {
  currency: Currency;
  estimatePowerKw: string;
  estimateProviderType: ChargingProviderType;
  estimateTariffType: ChargingTariffType;
  homeChargerPowerKw?: number | null;
  locale: Locale;
  parkEstimate: {
    cost: number;
    durationSeconds: number;
    gridEnergyKwh: number;
    pricePerKwh: number;
  } | null;
  setEstimatePowerKw: (value: string) => void;
  setEstimateProviderType: (value: ChargingProviderType) => void;
  setEstimateTariffType: (value: ChargingTariffType) => void;
  t: (key: TranslationKey, values?: Record<string, string | number>) => string;
}) {
  const durationText = parkEstimate
    ? formatDuration(Math.round(parkEstimate.durationSeconds))
    : "—";
  const costText = parkEstimate
    ? formatCurrencyAmount(currency, parkEstimate.cost, locale)
    : "—";
  const detailText = parkEstimate
    ? `${t("dashboard.estimateDetailCompact", {
        energy: fmt(parkEstimate.gridEnergyKwh, 1),
        price: formatCurrencyAmount(currency, parkEstimate.pricePerKwh, locale),
      })}${estimateTariffType === "fast_dc" ? ` · ${t("dashboard.estimateDcTaper")}` : ""}`
    : t("dashboard.estimateUnavailable");

  return (
    <div className="grid gap-2.5 text-xs">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {t("dashboard.parkEstimateEyebrow")}
          </p>
          <h2 className="mt-0.5 font-heading text-sm font-bold leading-tight tracking-normal">
            {t("dashboard.parkEstimateTitle")}
          </h2>
        </div>
        <div className="shrink-0 rounded-full border border-[var(--voltflow-green)]/25 bg-[var(--voltflow-green)]/10 px-2 py-0.5 text-[9px] font-bold text-[var(--voltflow-green)]">
          100%
        </div>
      </div>

      <div
        className="grid grid-cols-3 gap-1 rounded-full border border-border/70 bg-[#12151C]/70 p-0.5"
        aria-label={t("dashboard.estimateType")}
      >
        {CHARGE_TYPE_OPTIONS.map((item) => {
          const selected = item.value === estimateTariffType;
          return (
            <button
              key={item.value}
              type="button"
              onClick={() => {
                const next = item.value;
                setEstimateTariffType(next);
                setEstimatePowerKw(String(defaultEstimatePowerKw(next, homeChargerPowerKw)));
              }}
              className={cn(
                "rounded-full px-2 py-1 font-heading text-[10px] font-bold uppercase tracking-[0.08em] transition",
                selected
                  ? "bg-[var(--voltflow-green)]/18 text-[var(--voltflow-green)]"
                  : "text-muted-foreground hover:text-foreground",
              )}
              aria-pressed={selected}
            >
              {t(item.labelKey)}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-[1fr_4.35rem] gap-2">
        <div className="space-y-1">
          <Label htmlFor="park-estimate-provider" className="text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
            {t("dashboard.estimateProvider")}
          </Label>
          <Select
            value={estimateProviderType}
            onValueChange={(value) => setEstimateProviderType(value as ChargingProviderType)}
            items={PROVIDER_OPTIONS.map((item) => ({
              value: item.value,
              label: item.label,
            }))}
          >
            <SelectTrigger id="park-estimate-provider" className="h-8 rounded-xl px-2 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROVIDER_OPTIONS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="park-estimate-power" className="text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
            kW
          </Label>
          <Input
            id="park-estimate-power"
            type="text"
            inputMode="decimal"
            pattern="[0-9]*[,.]?[0-9]*"
            value={estimatePowerKw}
            onChange={(event) => setEstimatePowerKw(event.target.value)}
            className="h-8 rounded-xl px-2 text-xs"
          />
        </div>
      </div>

      <div className="rounded-2xl border border-border/70 bg-[#12151C]/55 px-3 py-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {t("dashboard.estimateTimeToFull")}
          </span>
          <span className="font-heading text-base font-bold tabular-nums">{durationText}</span>
        </div>
        <div className="mt-1 flex items-baseline justify-between gap-2">
          <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {t("dashboard.estimateCostToFull")}
          </span>
          <span className="font-heading text-base font-bold tabular-nums">{costText}</span>
        </div>
      </div>
      <p className="truncate text-[10px] leading-4 text-muted-foreground">{detailText}</p>
    </div>
  );
}

function DashboardLoadingSkeleton() {
  return (
    <>
      <section className="voltflow-card overflow-hidden p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3 w-16 rounded" />
            <Skeleton className="h-7 w-32 rounded-xl" />
          </div>
          <Skeleton className="h-7 w-16 rounded-full" />
        </div>
        <div className="mt-3 grid grid-cols-[132px_minmax(0,1fr)] items-center gap-4">
          <Skeleton className="aspect-square max-w-[132px] rounded-full" />
          <div className="space-y-3">
            <Skeleton className="h-10 w-full rounded-xl" />
            <div className="grid grid-cols-2 gap-2">
              <Skeleton className="h-16 rounded-xl" />
              <Skeleton className="h-16 rounded-xl" />
            </div>
          </div>
        </div>
        <Skeleton className="mt-4 h-14 w-full rounded-full" />
      </section>
      <div className="grid gap-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-[92px] rounded-2xl" />
        ))}
      </div>
    </>
  );
}

export function DashboardView() {
  const router = useRouter();
  const appPath = useAppPath();
  const qc = useQueryClient();
  const pageVisible = usePageVisible();
  const {
    data: carsResult,
    isLoading: loadingCars,
    isError: carsError,
    refetch: refetchCars,
  } = useCarsQuery();
  const cars = carsResult?.cars;
  const preferredCarId = carsResult?.preferredCarId ?? null;
  const { data: bydmateLive = [], isLoading: loadingLive } = useBydmateLiveQuery();
  const selectedCarId = useAppPreferences((s) => s.selectedCarId);
  const setSelectedCarId = useAppPreferences((s) => s.setSelectedCarId);
  const defaultPrice = useAppPreferences((s) => s.defaultPricePerKwh);
  const homePricePerKwh = useAppPreferences((s) => s.homePricePerKwh);
  const commercialAcPricePerKwh = useAppPreferences((s) => s.commercialAcPricePerKwh);
  const fastDcPricePerKwh = useAppPreferences((s) => s.fastDcPricePerKwh);
  const currency = useAppPreferences((s) => s.currency);
  const { locale, t } = useTranslation();

  const { data: sessions, isLoading: loadingSessions } = useQuery({
    queryKey: queryKeys.sessions,
    queryFn: fetchSessions,
    // Shared cadence — see chargingSessionsRefetchInterval. Was a flat 1s while
    // charging, which (via shortest-interval-wins on the shared queryKeys.sessions)
    // silently overrode the tiered background-sync poll whenever this screen mounted.
    refetchInterval: (query) =>
      chargingSessionsRefetchInterval(
        query.state.data as ChargingSessionRow[] | undefined,
        pageVisible,
      ),
  });

  const { data: tariffLocations = [] } = useQuery({
    queryKey: queryKeys.tariffLocations,
    queryFn: async () => {
      if (isDevAppRoute()) return [];
      const supabase = createClient();
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;
      if (!user) return [];
      const { data, error } = await supabase
        .from("charging_tariff_locations")
        .select("*")
        .eq("user_id", user.id);
      if (error) throw error;
      return (data ?? []).map((row) =>
        mapChargingTariffLocation(row as Record<string, unknown>),
      );
    },
  });

  const selectedCar =
    cars?.find((c) => c.id === selectedCarId) ?? cars?.[0] ?? null;
  const scopedVehicleId = selectedCar?.vehicle_alias ?? null;

  const baseBydmateSnapshot = useMemo(
    () => resolveLiveSnapshotForVehicle(bydmateLive, scopedVehicleId),
    [bydmateLive, scopedVehicleId],
  );
  const dashboardDevSnapshot = useDashboardDevSnapshot();
  const latestBydmateSnapshot = useDashboardDevSnapshotOverride(baseBydmateSnapshot);
  const forceDevMockMode = Boolean(dashboardDevSnapshot);
  const forceDevParkMode = dashboardDevSnapshot?.mode === "park";

  const activeSession = useMemo(
    () => {
      if (forceDevMockMode) return null;
      return sessions?.find(
        (s) => s.status === "charging" && (!selectedCar || s.car_id === selectedCar.id),
      ) ??
        sessions?.find((s) => s.status === "charging") ??
        null;
    },
    [forceDevMockMode, sessions, selectedCar],
  );

  const nowMs = useTickingClock(Boolean(activeSession) || pageVisible);

  const vehicleMode = deriveDashboardVehicleMode({
    snapshot: latestBydmateSnapshot,
    nowMs,
    hasActiveSession: Boolean(activeSession),
  });

  const tripVehicleId = latestBydmateSnapshot?.vehicle_id ?? scopedVehicleId;
  const { data: latestTrips = [], isLoading: loadingTrips } = useLatestBydmateTripsQuery(
    tripVehicleId,
    1,
    Boolean(tripVehicleId) && !forceDevMockMode,
    vehicleMode !== "driving",
  );

  const carSessions = useMemo(() => {
    if (forceDevMockMode) return [];
    if (!sessions) return [];
    if (!selectedCar) return sessions;
    return sessions.filter((s) => s.car_id === selectedCar.id);
  }, [forceDevMockMode, sessions, selectedCar]);

  const latestSession = carSessions[0] ?? null;
  const latestTrip = forceDevMockMode ? null : (latestTrips[0] ?? null);

  useEffect(() => {
    if (!cars?.length) return;
    const exists = cars.some((c) => c.id === selectedCarId);
    if (!exists) {
      const nextId =
        (preferredCarId && cars.some((c) => c.id === preferredCarId)
          ? preferredCarId
          : cars[0].id) ?? cars[0].id;
      setSelectedCarId(nextId);
    }
  }, [cars, preferredCarId, selectedCarId, setSelectedCarId]);

  const scopedLiveSnapshots = useMemo(
    () => filterLiveSnapshotsForVehicle(bydmateLive, scopedVehicleId),
    [bydmateLive, scopedVehicleId],
  );

  const liveActive = useMemo(() => {
    if (!activeSession?.started_at) return null;
    const startedAtMs = Date.parse(activeSession.started_at);
    return deriveChargingSessionLiveBundle({
      snapshots: scopedLiveSnapshots,
      params: chargingParamsFromSession(activeSession),
      startedAtMs,
      nowMs,
    }).display;
  }, [activeSession, scopedLiveSnapshots, nowMs]);

  const [ringDisplay, setRingDisplay] = useState<"percent" | "energy">("percent");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [startPct, setStartPct] = useState("42");
  const [targetPct, setTargetPct] = useState("100");
  const [chargerKw, setChargerKw] = useState("");
  const [price, setPrice] = useState(String(defaultPrice));
  const [manualProviderType, setManualProviderType] = useState<
    "custom" | "home" | "malanka" | "evika" | "forevo" | "zaryadka"
  >("custom");
  const [manualTariffType, setManualTariffType] = useState<"auto" | ChargingTariffType>(
    "auto",
  );
  const [estimateTariffType, setEstimateTariffType] = useState<ChargingTariffType>("home");
  const [estimateProviderType, setEstimateProviderType] =
    useState<ChargingProviderType>("home");
  const [estimatePowerKw, setEstimatePowerKw] = useState(
    String(defaultEstimatePowerKw("home", selectedCar?.default_charger_power_kw)),
  );
  const [estimateTariffTouched, setEstimateTariffTouched] = useState(false);
  const [estimateProviderTouched, setEstimateProviderTouched] = useState(false);
  const [estimatePowerTouched, setEstimatePowerTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const hasMounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const latestBydmateSoc = snapshotSoc(latestBydmateSnapshot);
  const liveStartPct = liveStartPercent(latestBydmateSnapshot);

  const statusLabel = String(t(dashboardVehicleStatusLabelKey(vehicleMode)));

  const actionButtonStatus =
    vehicleMode === "app_charging"
      ? "charging"
      : vehicleMode === "driving"
        ? "driving"
        : "idle";

  const canStartSession =
    hasMounted &&
    selectedCar &&
    !activeSession &&
    canStartChargingSession(vehicleMode);

  const currentPercent = forceDevParkMode
    ? (latestBydmateSoc ?? 64)
    : liveActive?.currentPercent ??
      activeSession?.current_percent ??
      latestBydmateSoc ??
      latestSession?.current_percent ??
      Number(startPct);

  const packCapacityKwh = selectedCar?.battery_capacity_kwh;
  const availableKwh = availableBatteryKwh(packCapacityKwh, currentPercent);
  const packTileValue =
    packCapacityKwh != null
      ? `${fmt(availableKwh, 1)} / ${fmt(packCapacityKwh, 0)} kWh`
      : "-- kWh";

  const ringToggleAriaLabel =
    ringDisplay === "percent"
      ? (t("dashboard.ringToggleEnergy") as string)
      : (t("dashboard.ringTogglePercent") as string);

  const displayChargePowerKw = resolveDisplayChargePowerKw({
    snapshot: latestBydmateSnapshot,
    sessionChargerPowerKw: activeSession?.charger_power_kw,
    defaultChargerPowerKw: selectedCar?.default_charger_power_kw,
  });

  const liveVehicleTitle = liveVehicleSummaryTitle(
    latestBydmateSnapshot,
    vehicleMode,
    statusLabel,
    displayChargePowerKw,
    (key, params) => String(t(key, params)),
    fmt,
  );

  const rangeEstimate = useVehicleRangeEstimate({
    baseSnapshot: forceDevMockMode ? latestBydmateSnapshot : baseBydmateSnapshot,
    scopedVehicleId,
    batteryCapacityKwh: selectedCar?.battery_capacity_kwh,
    fallbackSoc: currentPercent,
    recentTripsOverride: forceDevMockMode ? [] : undefined,
  });
  const rangeDetail =
    rangeEstimate?.estimatedRangeKm != null
      ? `≈ ${fmt(rangeEstimate.estimatedRangeKm)} km`
      : null;

  const estimateLocation = useMemo(() => {
    const lat = latestBydmateSnapshot?.location?.lat;
    const lon = latestBydmateSnapshot?.location?.lon;
    return typeof lat === "number" && typeof lon === "number" ? { lat, lon } : null;
  }, [latestBydmateSnapshot?.location?.lat, latestBydmateSnapshot?.location?.lon]);

  const estimateTariffLocationMatch = useMemo(
    () => resolveTariffLocationMatch(estimateLocation, tariffLocations),
    [estimateLocation, tariffLocations],
  );

  useEffect(() => {
    const matchedPreset = estimateTariffLocationMatch?.preset;
    const nextTariffType = matchedPreset?.tariff_type ?? "home";
    const nextProviderType = matchedPreset?.provider_type ?? "home";

    if (!estimateTariffTouched) {
      setEstimateTariffType(nextTariffType);
    }
    if (!estimateProviderTouched) {
      setEstimateProviderType(nextProviderType);
    }
    if (!estimatePowerTouched) {
      setEstimatePowerKw(
        String(defaultEstimatePowerKw(nextTariffType, selectedCar?.default_charger_power_kw)),
      );
    }
  }, [
    estimatePowerTouched,
    estimateProviderTouched,
    estimateTariffLocationMatch?.preset?.provider_type,
    estimateTariffLocationMatch?.preset?.tariff_type,
    estimateTariffTouched,
    selectedCar?.default_charger_power_kw,
  ]);

  const chargingProgressLine =
    activeSession && liveActive
      ? (() => {
          const effectivePricePerKwh =
            activeSession.price_per_kwh > 0
              ? activeSession.price_per_kwh
              : defaultPrice;
          const cost =
            effectivePricePerKwh > 0
              ? formatCurrencyAmount(
                  currency,
                  costFromGridEnergy(liveActive.chargedEnergyKwh, effectivePricePerKwh),
                  locale,
                )
              : "—";
          return t("dashboard.chargingProgress", {
            remaining: formatDuration(Math.round(liveActive.remainingSeconds)),
            energy: fmt(liveActive.chargedEnergyKwh, 2),
            cost,
          }) as string;
        })()
      : null;

  const parkEstimate = useMemo(() => {
    const capacityKwh =
      typeof packCapacityKwh === "number" && Number.isFinite(packCapacityKwh) && packCapacityKwh > 0
        ? packCapacityKwh
        : null;
    const soc =
      typeof currentPercent === "number" && Number.isFinite(currentPercent)
        ? Math.min(100, Math.max(0, currentPercent))
        : null;
    const powerKw = parseDecimalInput(estimatePowerKw);
    if (capacityKwh == null || soc == null || powerKw == null || powerKw <= 0) {
      return null;
    }

    const pricePerKwh = resolveTariffPrice(
      estimateTariffType,
      {
        default_price_per_kwh: defaultPrice,
        home_price_per_kwh: homePricePerKwh,
        commercial_ac_price_per_kwh: commercialAcPricePerKwh,
        fast_dc_price_per_kwh: fastDcPricePerKwh,
      },
      estimateProviderType,
    );
    const packEnergyKwh = energyNeededKwh(capacityKwh, soc, 100);
    const gridEnergyKwh = energyFromGridKwh(
      packEnergyKwh,
      selectedCar?.default_efficiency_percent ?? 90,
    );
    const durationSeconds = chargingSecondsToFull({
      batteryCapacityKwh: capacityKwh,
      currentPercent: soc,
      efficiencyPercent: selectedCar?.default_efficiency_percent ?? 90,
      powerKw,
      tariffType: estimateTariffType,
    });
    const cost = costFromGridEnergy(gridEnergyKwh, pricePerKwh);

    return {
      cost,
      durationSeconds,
      gridEnergyKwh,
      pricePerKwh,
    };
  }, [
    commercialAcPricePerKwh,
    currentPercent,
    defaultPrice,
    estimatePowerKw,
    estimateProviderType,
    estimateTariffType,
    fastDcPricePerKwh,
    homePricePerKwh,
    packCapacityKwh,
    selectedCar?.default_efficiency_percent,
  ]);

  const showParkEstimate = (vehicleMode === "parked" || vehicleMode === "stale") && !activeSession;

  const drivingStats =
    vehicleMode === "driving"
      ? drivingStatsFromLive(latestBydmateSnapshot, latestTrip)
      : null;

  const isChargingMode =
    vehicleMode === "app_charging" || vehicleMode === "live_charging";
  const chargingTileKw = displayChargePowerKw;

  const isPageLoading = loadingCars || (loadingLive && !latestBydmateSnapshot);

  const handleStart = async () => {
    if (!selectedCar) return;
    const start = Number(startPct);
    const target = Number(targetPct);
    if (!(start < target))
      return toast.error(t("dashboard.targetError") as string);
    if (start < 0 || target > 100)
      return toast.error(t("dashboard.percentError") as string);

    setSubmitting(true);
    const chargerPowerKw =
      chargerKw.trim() !== "" ? parseDecimalInput(chargerKw) : undefined;
    const overrides =
      chargerPowerKw !== undefined ? { chargerPowerKw } : {};
    try {
      const res = await startChargingSession({
        carId: selectedCar.id,
        startPercent: start,
        targetPercent: target,
        pricePerKwh: parseDecimalInput(price) || 0,
        tariffType:
          manualTariffType === "auto"
            ? undefined
            : (manualTariffType as ChargingTariffType),
        providerType: manualProviderType,
        ...overrides,
      });
      if (!res.ok) throw new Error(res.error);
      await ensureNotificationsPermission();
      await ensurePushSubscription();
      setDialogOpen(false);
      toast.success(t("dashboard.started") as string);
      router.push(appPath(`/charging/${res.sessionId}`));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : (t("dashboard.couldNotStart") as string));
    } finally {
      setSubmitting(false);
    }
  };

  const openQuickSession = () => {
    if (!canStartSession) return;
    if (liveStartPct !== null) setStartPct(liveStartPct);
    setPrice(String(defaultPrice));
    setManualTariffType("auto");
    setManualProviderType("custom");
    setDialogOpen(true);
  };

  const handleMainAction = async () => {
    if (!activeSession) {
      if (vehicleMode === "driving") {
        router.push(appPath("/vehicle"));
        return;
      }
      openQuickSession();
      return;
    }

    setStopping(true);
    const res = await stopChargingSession(activeSession.id);
    setStopping(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    await qc.invalidateQueries({ queryKey: queryKeys.sessions });
    toast.message(t("charging.saved") as string);
  };

  const mainButtonLabel =
    vehicleMode === "live_charging" && !activeSession
      ? (t("dashboard.trackCharge") as string)
      : vehicleMode === "driving"
        ? (t("dashboard.statusDriving") as string)
        : undefined;

  return (
    <div className="safe-bottom flex flex-col gap-5 px-4 pb-6 pt-5">
      <header className="flex items-center justify-between gap-4">
        <LogoFull />
        <BrandBadge className="hidden min-[380px]:inline-flex">
          {t("dashboard.fullControl")}
        </BrandBadge>
      </header>

      {isPageLoading ? <DashboardLoadingSkeleton /> : null}

      {!loadingCars && carsError ? (
        <Card className="voltflow-card border-border bg-transparent">
          <CardContent className="space-y-4 p-5">
            <p className="text-sm leading-6 text-muted-foreground">
              {t("dashboard.loadError")}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" className="rounded-full" onClick={() => void refetchCars()}>
                {t("charging.checkAgain")}
              </Button>
              <Button asChild className="rounded-full">
                <Link href={appPath("/login?next=/dashboard")}>{t("dashboard.signIn")}</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {!loadingCars && !carsError && cars && cars.length === 0 ? (
        <section className="voltflow-card p-5">
          <div className="flex items-start gap-3">
            <ChargingBolt className="size-10 shrink-0" aria-hidden />
            <div>
              <h1 className="font-heading text-2xl font-bold tracking-normal">
                {t("dashboard.addEvTitle")}
              </h1>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {t("dashboard.addEvBody")}
              </p>
            </div>
          </div>
          <Button
            asChild
            size="lg"
            className="mt-5 h-14 w-full rounded-full bg-[linear-gradient(90deg,#00E676_0%,#00D1FF_100%)] font-heading text-base font-bold text-[#06110B]"
          >
            <Link href={appPath("/cars/new")}>{t("dashboard.addVehicle")}</Link>
          </Button>
        </section>
      ) : null}

      {!isPageLoading && !carsError && cars && cars.length > 0 ? (
        <>
          <section className="voltflow-card overflow-hidden p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  {t("dashboard.vehicle")}
                </p>
                <h1 className="mt-1 truncate font-heading text-xl font-bold tracking-normal">
                  {selectedCar?.name ?? "EV"}
                </h1>
              </div>
              <div
                className={`rounded-full border border-border bg-white/[0.04] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] ${statusBadgeClass(vehicleMode)}`}
              >
                {loadingSessions ? (t("dashboard.syncing") as string) : statusLabel}
              </div>
            </div>

            <div className="mt-3 grid grid-cols-[132px_minmax(0,1fr)] items-center gap-4">
              <div className="relative pb-4">
                <BatteryRing
                  percent={currentPercent}
                  status={loadingSessions ? (t("dashboard.syncing") as string) : statusLabel}
                  charging={
                    vehicleMode === "app_charging" || vehicleMode === "live_charging"
                  }
                  size="compact"
                  displayMode={ringDisplay}
                  energyKwh={availableKwh}
                  toggleAriaLabel={ringToggleAriaLabel}
                  onToggleDisplay={() =>
                    setRingDisplay((mode) => (mode === "percent" ? "energy" : "percent"))
                  }
                />
                <RangeBadge value={rangeDetail} />
              </div>
              <div className="min-w-0 space-y-3">
                {cars.length > 1 ? (
                  <Select
                    items={cars.map((car) => ({
                      value: car.id,
                      label: car.name,
                    }))}
                    value={selectedCar?.id}
                    onValueChange={(value) => setSelectedCarId(value)}
                  >
                    <SelectTrigger className="h-10 rounded-xl border-border bg-[#12151C]/70 text-sm">
                      <SelectValue placeholder={t("dashboard.chooseCar") as string} />
                    </SelectTrigger>
                    <SelectContent>
                      {cars.map((car) => (
                        <SelectItem key={car.id} value={car.id}>
                          <div className="flex flex-col text-left leading-tight">
                            <span className="font-medium">{car.name}</span>
                            <span className="text-muted-foreground text-xs">
                              {t("dashboard.pack", {
                                battery: car.battery_capacity_kwh,
                                power: car.default_charger_power_kw,
                              })}
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : null}

                <div className="text-xs">
                  {drivingStats ? (
                    <DrivingStatsGrid
                      items={[
                        {
                          label: t("dashboard.driveAvgSpeed") as string,
                          ...drivingStatParts(drivingStats.avgSpeedKmh, 0, "km/h"),
                          accent: "cyan",
                        },
                        {
                          label: t("dashboard.driveConsumption") as string,
                          ...drivingStatParts(drivingStats.consumptionKwh100, 1, "kWh/100"),
                        },
                        {
                          label: t("dashboard.driveDistance") as string,
                          ...drivingStatParts(drivingStats.distanceKm, 1, "km"),
                        },
                        {
                          label: t("dashboard.driveRegen") as string,
                          ...drivingStatParts(drivingStats.regenKwh, 2, "kWh"),
                          accent: "green",
                        },
                      ]}
                    />
                  ) : showParkEstimate ? (
                    <ParkChargeEstimatePanel
                      currency={currency}
                      estimatePowerKw={estimatePowerKw}
                      estimateProviderType={estimateProviderType}
                      estimateTariffType={estimateTariffType}
                      homeChargerPowerKw={selectedCar?.default_charger_power_kw}
                      locale={locale}
                      parkEstimate={parkEstimate}
                      setEstimatePowerKw={(value) => {
                        setEstimatePowerTouched(true);
                        setEstimatePowerKw(value);
                      }}
                      setEstimateProviderType={(value) => {
                        setEstimateProviderTouched(true);
                        setEstimateProviderType(value);
                      }}
                      setEstimateTariffType={(value) => {
                        setEstimateTariffTouched(true);
                        setEstimateTariffType(value);
                      }}
                      t={(key, values) => String(t(key, values))}
                    />
                  ) : (
                    <div
                      className={cn(
                        "grid gap-2",
                        isChargingMode ? "grid-cols-2" : "grid-cols-1",
                      )}
                    >
                      <DashboardStatTile
                        label={t("dashboard.packShort") as string}
                        value={packTileValue}
                      />
                      {isChargingMode ? (
                        <DashboardStatTile
                          label={t("dashboard.chargerShort") as string}
                          value={`${fmt(chargingTileKw, 1)} kW`}
                        />
                      ) : null}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {chargingProgressLine ? (
              <p className="mt-3 text-center text-xs font-medium text-muted-foreground">
                {chargingProgressLine}
              </p>
            ) : null}

            <div className="mt-4 grid gap-2">
              <ChargingActionButton
                status={actionButtonStatus}
                disabled={!selectedCar || stopping}
                loading={stopping}
                labels={{
                  start: mainButtonLabel ?? (t("dashboard.startCharging") as string),
                  stop: t("charging.stop") as string,
                  syncing: t("dashboard.syncing") as string,
                  driving: t("dashboard.statusDriving") as string,
                }}
                onClick={() => void handleMainAction()}
              />
            </div>
          </section>

          <section className="grid gap-3">
            <DashboardSummaryCard
              href={
                latestTrip
                  ? appPath(`/vehicle?trip=${encodeURIComponent(latestTrip.id)}`)
                  : appPath("/vehicle")
              }
              icon={<Route className="size-5" aria-hidden />}
              label={t("dashboard.latestTrip") as string}
              title={
                loadingTrips
                  ? (t("dashboard.loading") as string)
                  : latestTrip
                    ? `${fmt(latestTrip.distance_km, 1)} km`
                    : (t("dashboard.noTrip") as string)
              }
              body={
                latestTrip
                  ? formatClockRange(
                      latestTrip.started_at,
                      latestTrip.ended_at ?? latestTrip.last_device_time,
                      locale,
                    )
                  : (t("dashboard.openVehicle") as string)
              }
              meta={
                latestTrip
                  ? `${tripSoc(latestTrip)} · ${fmt(latestTrip.avg_consumption_kwh_100km, 1)} kWh/100`
                  : undefined
              }
            />
            <DashboardSummaryCard
              href={
                latestSession
                  ? appPath(`/history/${latestSession.id}`)
                  : appPath("/charging")
              }
              icon={<BatteryCharging className="size-5" aria-hidden />}
              label={t("dashboard.latestCharge") as string}
              title={
                latestSession
                  ? `${fmt(latestSession.start_percent)}% -> ${fmt(latestSession.current_percent)}%`
                  : (t("dashboard.noCharge") as string)
              }
              body={
                latestSession
                  ? formatClockRange(
                      latestSession.started_at ?? latestSession.created_at,
                      latestSession.stopped_at ?? latestSession.updated_at,
                      locale,
                    )
                  : (t("dashboard.startFirstCharge") as string)
              }
              meta={
                latestSession
                  ? `${fmt(latestSession.charged_energy_kwh, 2)} kWh · ${durationBetween(
                      latestSession.started_at ?? latestSession.created_at,
                      latestSession.stopped_at ?? latestSession.updated_at,
                    )}`
                  : undefined
              }
            />
            <DashboardSummaryCard
              href={appPath("/vehicle")}
              icon={<CarFront className="size-5" aria-hidden />}
              label={t("dashboard.liveVehicle") as string}
              title={liveVehicleTitle}
              body={
                latestBydmateSnapshot
                  ? formatClockRange(latestBydmateSnapshot.device_time, null, locale)
                  : "—"
              }
              meta={
                latestBydmateSnapshot
                  ? `${fmt(latestBydmateSnapshot.telemetry.speed_kmh)} km/h · ${fmt(
                      latestBydmateSnapshot.telemetry.power_kw,
                      1,
                    )} kW`
                  : "0 km/h · 0.0 kW"
              }
            />
          </section>
        </>
      ) : null}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="gap-6 rounded-[1.75rem] border-border bg-card">
          <DialogHeader>
            <DialogTitle className="font-heading text-xl">
              {t("dashboard.quickSession")}
            </DialogTitle>
            <p className="text-muted-foreground text-base">
              {t("dashboard.quickSessionBody")}
            </p>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="start-pct">{t("dashboard.currentCharge")}</Label>
              <Input
                id="start-pct"
                inputMode="numeric"
                pattern="[0-9]*"
                min={0}
                max={99}
                step="1"
                type="number"
                value={startPct}
                onChange={(e) => setStartPct(e.target.value)}
                className="h-[52px] rounded-xl text-lg"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="target-pct">{t("dashboard.targetCharge")}</Label>
              <Input
                id="target-pct"
                inputMode="numeric"
                pattern="[0-9]*"
                type="number"
                value={targetPct}
                min={Number(startPct) + 1}
                max={100}
                step="1"
                onChange={(e) => setTargetPct(e.target.value)}
                className="h-[52px] rounded-xl text-lg"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="charger-kw">{t("dashboard.powerOverride")}</Label>
              <Input
                id="charger-kw"
                placeholder={t("dashboard.defaultPower", {
                  power: selectedCar?.default_charger_power_kw ?? "--",
                }) as string}
                type="text"
                inputMode="decimal"
                pattern="[0-9]*[,.]?[0-9]*"
                step="0.1"
                value={chargerKw}
                onChange={(e) => setChargerKw(e.target.value)}
                className="h-[52px] rounded-xl text-lg"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="session-provider-type">Provider</Label>
              <Select
                value={manualProviderType}
                onValueChange={(value) =>
                  setManualProviderType(
                    value as
                      | "custom"
                      | "home"
                      | "malanka"
                      | "evika"
                      | "forevo"
                      | "zaryadka",
                  )
                }
                items={[
                  { value: "custom", label: PROVIDER_LABELS.custom },
                  { value: "home", label: PROVIDER_LABELS.home },
                  { value: "malanka", label: PROVIDER_LABELS.malanka },
                  { value: "evika", label: PROVIDER_LABELS.evika },
                  { value: "forevo", label: PROVIDER_LABELS.forevo },
                  { value: "zaryadka", label: PROVIDER_LABELS.zaryadka },
                ]}
              >
                <SelectTrigger id="session-provider-type" className="h-[52px] rounded-xl text-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="custom">{PROVIDER_LABELS.custom}</SelectItem>
                  <SelectItem value="home">{PROVIDER_LABELS.home}</SelectItem>
                  <SelectItem value="malanka">{PROVIDER_LABELS.malanka}</SelectItem>
                  <SelectItem value="evika">{PROVIDER_LABELS.evika}</SelectItem>
                  <SelectItem value="forevo">{PROVIDER_LABELS.forevo}</SelectItem>
                  <SelectItem value="zaryadka">{PROVIDER_LABELS.zaryadka}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="session-tariff-type">Tariff type</Label>
              <Select
                value={manualTariffType}
                onValueChange={(value) =>
                  setManualTariffType(value as "auto" | ChargingTariffType)
                }
                items={[
                  { value: "auto", label: "Auto by power/location" },
                  { value: "home", label: "Home" },
                  { value: "commercial_ac", label: "Commercial AC" },
                  { value: "fast_dc", label: "Fast DC" },
                ]}
              >
                <SelectTrigger id="session-tariff-type" className="h-[52px] rounded-xl text-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto by power/location</SelectItem>
                  <SelectItem value="home">Home</SelectItem>
                  <SelectItem value="commercial_ac">Commercial AC</SelectItem>
                  <SelectItem value="fast_dc">Fast DC</SelectItem>
                </SelectContent>
              </Select>
              {manualTariffType === "auto" ? (
                <p className="text-muted-foreground text-xs">
                  Auto rule: AC 4.0-9.99 kW, fast DC 10.0+ kW.
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="energy-price">
                {t("dashboard.price", { currency: currencySymbols[currency] })}
              </Label>
              <Input
                id="energy-price"
                type="text"
                inputMode="decimal"
                pattern="[0-9]*[,.]?[0-9]*"
                step="any"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="h-[52px] rounded-xl text-lg"
              />
              <p className="text-muted-foreground text-xs">
                {t("dashboard.priceHelp")}
              </p>
            </div>
          </div>
          <DialogFooter className="flex gap-3 sm:flex-col">
            <Button
              variant="outline"
              className="min-h-[48px] rounded-full border-white/25"
              onClick={() => setDialogOpen(false)}
            >
              {t("common.later")}
            </Button>
            <Button
              className="min-h-[52px] flex-1 rounded-full bg-[linear-gradient(90deg,#00E676_0%,#00D1FF_100%)] text-base font-semibold text-[#06110B] hover:brightness-110"
              disabled={submitting || !selectedCar}
              onClick={() => void handleStart()}
            >
              {submitting ? t("dashboard.starting") : t("dashboard.startSession")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
