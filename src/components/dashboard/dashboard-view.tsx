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
import { useDashboardDevSnapshotOverride } from "@/components/dev/dashboard-dev-snapshot-context";
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
import { fetchSessions } from "@/hooks/use-sessions-query";
import { useTickingClock } from "@/hooks/use-ticking-clock";
import { useTranslation } from "@/hooks/use-translation";
import { formatDuration } from "@/lib/charging-math";
import { estimateRangeFromSoc, estimateVehicleRangeKm } from "@/lib/bydmate/range-estimate";
import {
  chargingParamsFromSession,
  deriveChargingSessionLiveBundle,
  filterLiveSnapshotsForVehicle,
} from "@/lib/charging-session-sync";
import { snapshotSoc } from "@/lib/charging-live";
import { useAppPath } from "@/lib/dev/dev-path";
import { currencySymbols } from "@/lib/i18n";
import { parseDecimalInput } from "@/lib/number-input";
import { ensureNotificationsPermission, ensurePushSubscription } from "@/lib/push/client";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import {
  canStartChargingSession,
  dashboardVehicleStatusLabelKey,
  deriveDashboardVehicleMode,
  resolveLiveSnapshotForVehicle,
  type DashboardVehicleMode,
} from "@/lib/vehicle-live-mode";
import { useAppPreferences } from "@/stores/use-app-preferences";
import type { BydmateLiveSnapshotRow, BydmateTripRow, ChargingSessionRow } from "@/types/database";

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
  const currency = useAppPreferences((s) => s.currency);
  const { locale, t } = useTranslation();

  const { data: sessions, isLoading: loadingSessions } = useQuery({
    queryKey: queryKeys.sessions,
    queryFn: fetchSessions,
    refetchInterval: (query) => {
      if (!pageVisible) return false;
      const list = query.state.data as ChargingSessionRow[] | undefined;
      return list?.some((s) => s.status === "charging") ? 1000 : false;
    },
  });

  const selectedCar =
    cars?.find((c) => c.id === selectedCarId) ?? cars?.[0] ?? null;
  const scopedVehicleId = selectedCar?.vehicle_alias ?? null;

  const baseBydmateSnapshot = useMemo(
    () => resolveLiveSnapshotForVehicle(bydmateLive, scopedVehicleId),
    [bydmateLive, scopedVehicleId],
  );
  const latestBydmateSnapshot = useDashboardDevSnapshotOverride(baseBydmateSnapshot);

  const activeSession = useMemo(
    () =>
      sessions?.find(
        (s) => s.status === "charging" && (!selectedCar || s.car_id === selectedCar.id),
      ) ??
      sessions?.find((s) => s.status === "charging") ??
      null,
    [sessions, selectedCar],
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
    Boolean(tripVehicleId),
    vehicleMode !== "driving",
  );

  const carSessions = useMemo(() => {
    if (!sessions) return [];
    if (!selectedCar) return sessions;
    return sessions.filter((s) => s.car_id === selectedCar.id);
  }, [sessions, selectedCar]);

  const latestSession = carSessions[0] ?? null;
  const latestTrip = latestTrips[0] ?? null;

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

  const [dialogOpen, setDialogOpen] = useState(false);
  const [startPct, setStartPct] = useState("42");
  const [targetPct, setTargetPct] = useState("100");
  const [chargerKw, setChargerKw] = useState("");
  const [price, setPrice] = useState(String(defaultPrice));
  const [submitting, setSubmitting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const hasMounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const latestBydmateSoc = snapshotSoc(latestBydmateSnapshot);
  const liveStartPct = liveStartPercent(latestBydmateSnapshot);

  const statusLabel = t(dashboardVehicleStatusLabelKey(vehicleMode)) as string;

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

  const currentPercent =
    liveActive?.currentPercent ??
    activeSession?.current_percent ??
    latestBydmateSoc ??
    latestSession?.current_percent ??
    Number(startPct);

  const rangeEstimate = latestBydmateSnapshot
    ? estimateVehicleRangeKm(latestBydmateSnapshot, latestTrips)
    : estimateRangeFromSoc({
        soc: currentPercent,
        batteryCapacityKwh: selectedCar?.battery_capacity_kwh,
        recentTrips: latestTrips,
      });
  const rangeDetail =
    rangeEstimate?.estimatedRangeKm != null
      ? `≈ ${fmt(rangeEstimate.estimatedRangeKm)} km`
      : null;

  const chargingProgressLine =
    activeSession && liveActive
      ? (t("dashboard.chargingProgress", {
          remaining: formatDuration(Math.round(liveActive.remainingSeconds)),
          energy: fmt(liveActive.chargedEnergyKwh, 2),
          cost: `${currencySymbols[currency]}${fmt(liveActive.estimatedCost, 2)}`,
        }) as string)
      : null;

  const drivingStats =
    vehicleMode === "driving"
      ? drivingStatsFromLive(latestBydmateSnapshot, latestTrip)
      : null;

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
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <DashboardStatTile
                        label={t("dashboard.packShort") as string}
                        value={`${selectedCar?.battery_capacity_kwh ?? "--"} kWh`}
                      />
                      <DashboardStatTile
                        label={t("dashboard.chargerShort") as string}
                        value={`${selectedCar?.default_charger_power_kw ?? "--"} kW`}
                      />
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
              title={
                latestBydmateSoc != null
                  ? `${fmt(latestBydmateSoc)}% SOC`
                  : (t("dashboard.noLiveData") as string)
              }
              body={
                latestBydmateSnapshot
                  ? formatClockRange(latestBydmateSnapshot.device_time, null, locale)
                  : (t("dashboard.openVehicle") as string)
              }
              meta={
                latestBydmateSnapshot
                  ? `${fmt(latestBydmateSnapshot.telemetry.speed_kmh)} km/h · ${fmt(
                      latestBydmateSnapshot.telemetry.power_kw,
                      1,
                    )} kW`
                  : undefined
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
