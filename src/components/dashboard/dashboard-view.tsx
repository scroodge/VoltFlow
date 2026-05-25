"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BatteryCharging, CarFront, Route, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { startChargingSession, stopChargingSession } from "@/actions/sessions";
import { BrandBadge } from "@/components/brand/BrandBadge";
import { ChargingBolt } from "@/components/brand/ChargingBolt";
import { LogoFull } from "@/components/brand/LogoFull";
import { BatteryRing } from "@/components/charging/BatteryRing";
import { ChargingActionButton } from "@/components/charging/ChargingActionButton";
import { ChargingStatsGrid, type ChargingStat } from "@/components/charging/ChargingStatsGrid";
import { Button } from "@/components/ui/button";
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
import { fetchSessions } from "@/hooks/use-sessions-query";
import { useTickingClock } from "@/hooks/use-ticking-clock";
import { useTranslation } from "@/hooks/use-translation";
import {
  deriveChargingState,
  formatDuration,
  type ChargingParams,
} from "@/lib/charging-math";
import {
  deriveLiveChargingState,
  findFreshChargingSnapshot,
  snapshotChargePowerKw,
} from "@/lib/charging-live";
import { currencySymbols, formatCurrencyAmount } from "@/lib/i18n";
import { parseDecimalInput } from "@/lib/number-input";
import { ensureNotificationsPermission, ensurePushSubscription } from "@/lib/push/client";
import { queryKeys } from "@/lib/query-keys";
import { useAppPreferences } from "@/stores/use-app-preferences";
import type { BydmateTripRow, ChargingSessionRow } from "@/types/database";

function liveStationarySoc(soc: number | null | undefined, speedKmh: number | null | undefined) {
  if (speedKmh !== 0 || typeof soc !== "number" || !Number.isFinite(soc)) return null;
  if (soc < 0 || soc >= 100) return null;
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
      className="grid min-h-[104px] content-between rounded-2xl border border-border bg-white/[0.03] p-3.5 transition hover:border-primary/50 hover:bg-white/[0.05]"
    >
      <span className="flex items-center justify-between gap-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        <span>{label}</span>
        <span className="text-[var(--voltflow-cyan)]">{icon}</span>
      </span>
      <span className="mt-3 block">
        <span className="block font-heading text-lg font-bold tracking-normal text-foreground">
          {title}
        </span>
        <span className="mt-1 block text-sm leading-5 text-muted-foreground">{body}</span>
      </span>
      {meta ? (
        <span className="mt-3 block truncate text-xs font-medium text-muted-foreground">
          {meta}
        </span>
      ) : null}
    </Link>
  );
}

export function DashboardView() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: cars, isLoading } = useCarsQuery();
  const { data: bydmateLive = [] } = useBydmateLiveQuery();
  const selectedCarId = useAppPreferences((s) => s.selectedCarId);
  const setSelectedCarId = useAppPreferences((s) => s.setSelectedCarId);
  const defaultPrice = useAppPreferences((s) => s.defaultPricePerKwh);
  const currency = useAppPreferences((s) => s.currency);
  const { locale, t } = useTranslation();

  const { data: sessions, isLoading: loadingSessions } = useQuery({
    queryKey: queryKeys.sessions,
    queryFn: fetchSessions,
    refetchInterval: (query) => {
      const list = query.state.data as ChargingSessionRow[] | undefined;
      return list?.some((s) => s.status === "charging") ? 1000 : false;
    },
  });

  const activeSession = useMemo(
    () => sessions?.find((s) => s.status === "charging") ?? null,
    [sessions],
  );
  const nowMs = useTickingClock(Boolean(activeSession));
  const latestBydmateSnapshot = bydmateLive[0] ?? null;
  const liveChargingSnapshot = useMemo(
    () => findFreshChargingSnapshot(bydmateLive, nowMs),
    [bydmateLive, nowMs],
  );
  const { data: latestTrips = [], isLoading: loadingTrips } = useLatestBydmateTripsQuery(
    latestBydmateSnapshot?.vehicle_id ?? null,
  );
  const stationaryLiveStartPct = liveStationarySoc(
    latestBydmateSnapshot?.telemetry.soc,
    latestBydmateSnapshot?.telemetry.speed_kmh,
  );
  const latestSession = sessions?.[0] ?? null;
  const latestTrip = latestTrips[0] ?? null;

  const selectedCar =
    cars?.find((c) => c.id === selectedCarId) ?? cars?.[0] ?? null;

  useEffect(() => {
    if (!cars?.length) return;
    const exists = cars.some((c) => c.id === selectedCarId);
    if (!exists) setSelectedCarId(cars[0].id);
  }, [cars, selectedCarId, setSelectedCarId]);

  const liveActive = useMemo(() => {
    if (!activeSession?.started_at) return null;
    const params: ChargingParams = {
      startPercent: activeSession.start_percent,
      targetPercent: activeSession.target_percent,
      batteryCapacityKwh: activeSession.battery_capacity_kwh,
      chargerPowerKw: activeSession.charger_power_kw,
      efficiencyPercent: activeSession.efficiency_percent,
      pricePerKwh: activeSession.price_per_kwh,
    };
    const startedAtMs = Date.parse(activeSession.started_at);
    return (
      deriveLiveChargingState({
        snapshot: liveChargingSnapshot,
        params,
        startedAtMs,
        nowMs,
      }) ?? deriveChargingState(params, startedAtMs, nowMs)
    );
  }, [activeSession, liveChargingSnapshot, nowMs]);

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

  const canStartSession = hasMounted && selectedCar && !activeSession;
  const dashboardStatus = activeSession
    ? "charging"
    : latestSession?.status === "completed"
      ? "completed"
      : "idle";
  const statusLabel =
    dashboardStatus === "charging"
      ? (t("dashboard.statusCharging") as string)
      : dashboardStatus === "completed"
        ? (t("dashboard.statusCompleted") as string)
        : (t("dashboard.statusIdle") as string);
  const currentPercent =
    liveActive?.currentPercent ??
    activeSession?.current_percent ??
    latestSession?.current_percent ??
    Number(startPct);
  const liveChargePowerKw = activeSession
    ? snapshotChargePowerKw(liveChargingSnapshot)
    : null;

  const stats: ChargingStat[] = [
    {
      label: t("dashboard.chargedKwh") as string,
      value: `${(liveActive?.chargedEnergyKwh ?? activeSession?.charged_energy_kwh ?? 0).toFixed(2)}`,
      accent: "green",
    },
    {
      label: t("dashboard.remainingStat") as string,
      value: activeSession
        ? formatDuration(liveActive?.remainingSeconds ?? 0)
        : "--",
      accent: "cyan",
    },
    {
      label: t("dashboard.powerStat") as string,
      value: `${(liveChargePowerKw ?? activeSession?.charger_power_kw ?? selectedCar?.default_charger_power_kw ?? 0).toFixed(1)} kW`,
      accent: "blue",
    },
    {
      label: t("dashboard.costStat") as string,
      value: formatCurrencyAmount(
        currency,
        liveActive?.estimatedCost ?? activeSession?.estimated_cost ?? 0,
        locale,
      ),
    },
  ];

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
      router.push(`/charging/${res.sessionId}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : (t("dashboard.couldNotStart") as string));
    } finally {
      setSubmitting(false);
    }
  };

  const handleMainAction = async () => {
    if (!activeSession) {
      if (canStartSession) {
        if (stationaryLiveStartPct !== null) setStartPct(stationaryLiveStartPct);
        setPrice(String(defaultPrice));
        setDialogOpen(true);
      }
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

  return (
    <div className="safe-bottom flex flex-col gap-5 px-4 pb-6 pt-5">
      <header className="flex items-center justify-between gap-4">
        <LogoFull />
        <BrandBadge className="hidden min-[380px]:inline-flex">
          {t("dashboard.fullControl")}
        </BrandBadge>
      </header>

      {!isLoading && cars && cars.length === 0 ? (
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
            <Link href="/cars/new">{t("dashboard.addVehicle")}</Link>
          </Button>
        </section>
      ) : null}

      {cars && cars.length > 0 ? (
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
              <div className="rounded-full border border-border bg-white/[0.04] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--voltflow-green)]">
                {statusLabel}
              </div>
            </div>

            <div className="mt-3 grid grid-cols-[132px_minmax(0,1fr)] items-center gap-4">
              <BatteryRing
                percent={currentPercent}
                status={loadingSessions ? (t("dashboard.syncing") as string) : statusLabel}
                charging={dashboardStatus === "charging"}
                size="compact"
              />
              <div className="min-w-0 space-y-3">
                {isLoading ? (
                  <Skeleton className="h-10 w-full rounded-xl" />
                ) : (
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
                )}

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-xl border border-border bg-white/[0.03] p-2.5">
                    <p className="truncate text-muted-foreground">{t("dashboard.batteryPack")}</p>
                    <p className="mt-1 font-heading text-base font-bold">
                      {selectedCar?.battery_capacity_kwh ?? "--"} kWh
                    </p>
                  </div>
                  <div className="rounded-xl border border-border bg-white/[0.03] p-2.5">
                    <p className="truncate text-muted-foreground">{t("dashboard.chargerPower")}</p>
                    <p className="mt-1 font-heading text-base font-bold">
                      {selectedCar?.default_charger_power_kw ?? "--"} kW
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 grid gap-2">
              <ChargingActionButton
                status={dashboardStatus}
                disabled={!selectedCar || stopping}
                loading={stopping}
                labels={{
                  start: t("dashboard.startCharging") as string,
                  stop: t("charging.stop") as string,
                  syncing: t("dashboard.syncing") as string,
                }}
                onClick={() => void handleMainAction()}
              />
              <Button
                asChild
                variant="outline"
                size="lg"
                className="h-11 w-full rounded-full border-border bg-white/[0.03] font-heading text-sm font-bold"
              >
                <Link href={activeSession ? `/charging/${activeSession.id}` : "/settings"}>
                  <SlidersHorizontal className="size-4" aria-hidden />
                  {t("dashboard.adjustSettings")}
                </Link>
              </Button>
            </div>
          </section>

          <section className="grid gap-3 min-[520px]:grid-cols-3">
            <DashboardSummaryCard
              href="/vehicle"
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
              href={latestSession ? "/history" : "/charging"}
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
              href="/vehicle"
              icon={<CarFront className="size-5" aria-hidden />}
              label={t("dashboard.liveVehicle") as string}
              title={
                latestBydmateSnapshot
                  ? `${fmt(latestBydmateSnapshot.telemetry.soc)}% SOC`
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

          {activeSession ? <ChargingStatsGrid stats={stats} compact /> : null}
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
