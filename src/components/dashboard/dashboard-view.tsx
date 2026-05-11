"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Gauge, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { useCarsQuery } from "@/hooks/use-cars-query";
import { fetchSessions } from "@/hooks/use-sessions-query";
import { useTickingClock } from "@/hooks/use-ticking-clock";
import { useTranslation } from "@/hooks/use-translation";
import {
  deriveChargingState,
  formatDuration,
  type ChargingParams,
} from "@/lib/charging-math";
import { currencySymbols, formatCurrencyAmount } from "@/lib/i18n";
import { queryKeys } from "@/lib/query-keys";
import { useAppPreferences } from "@/stores/use-app-preferences";
import type { ChargingSessionRow } from "@/types/database";

export function DashboardView() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: cars, isLoading } = useCarsQuery();
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
  const latestSession = sessions?.[0] ?? null;
  const nowMs = useTickingClock(Boolean(activeSession));

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
    return deriveChargingState(params, Date.parse(activeSession.started_at), nowMs);
  }, [activeSession, nowMs]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [startPct, setStartPct] = useState("42");
  const [targetPct, setTargetPct] = useState("90");
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
      ? "Charging"
      : dashboardStatus === "completed"
        ? "Completed"
        : "Idle";
  const currentPercent =
    liveActive?.currentPercent ??
    activeSession?.current_percent ??
    latestSession?.current_percent ??
    Number(startPct);

  const stats: ChargingStat[] = [
    {
      label: "Charged kWh",
      value: `${(liveActive?.chargedEnergyKwh ?? activeSession?.charged_energy_kwh ?? 0).toFixed(2)}`,
      accent: "green",
    },
    {
      label: "Remaining",
      value: activeSession
        ? formatDuration(liveActive?.remainingSeconds ?? 0)
        : "--",
      accent: "cyan",
    },
    {
      label: "Power",
      value: `${(activeSession?.charger_power_kw ?? selectedCar?.default_charger_power_kw ?? 0).toFixed(1)} kW`,
      accent: "blue",
    },
    {
      label: "Cost",
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
    const overrides =
      chargerKw.trim() !== "" ? { chargerPowerKw: Number(chargerKw) } : {};
    try {
      const res = await startChargingSession({
        carId: selectedCar.id,
        startPercent: start,
        targetPercent: target,
        pricePerKwh: Number(price) || 0,
        ...overrides,
      });
      if (!res.ok) throw new Error(res.error);
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
          Full control
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
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  Vehicle
                </p>
                <h1 className="mt-1 font-heading text-2xl font-bold tracking-normal">
                  {selectedCar?.name ?? "EV"}
                </h1>
              </div>
              <div className="rounded-full border border-border bg-white/[0.04] px-3 py-1.5 text-xs font-bold uppercase tracking-[0.16em] text-[var(--voltflow-green)]">
                {statusLabel}
              </div>
            </div>

            <div className="mt-4">
              {isLoading ? (
                <Skeleton className="h-14 w-full rounded-2xl" />
              ) : (
                <Select
                  items={cars.map((car) => ({
                    value: car.id,
                    label: car.name,
                  }))}
                  value={selectedCar?.id}
                  onValueChange={(value) => setSelectedCarId(value)}
                >
                  <SelectTrigger className="h-14 rounded-2xl border-border bg-[#12151C]/70 text-base">
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
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-2xl border border-border bg-white/[0.03] p-3">
                <p className="text-muted-foreground">Battery pack</p>
                <p className="mt-1 font-heading text-lg font-bold">
                  {selectedCar?.battery_capacity_kwh ?? "--"} kWh
                </p>
              </div>
              <div className="rounded-2xl border border-border bg-white/[0.03] p-3">
                <p className="text-muted-foreground">Charger power</p>
                <p className="mt-1 font-heading text-lg font-bold">
                  {selectedCar?.default_charger_power_kw ?? "--"} kW
                </p>
              </div>
            </div>
          </section>

          <section className="voltflow-card p-5 text-center">
            <BatteryRing
              percent={currentPercent}
              status={loadingSessions ? "Syncing" : statusLabel}
              charging={dashboardStatus === "charging"}
            />
            <p className="mx-auto mt-1 max-w-[18rem] text-sm leading-6 text-muted-foreground">
              {activeSession
                ? "Smart charging. Full control. Every time."
                : "Energy in motion. Set your target and let VoltFlow track the run."}
            </p>
          </section>

          <ChargingStatsGrid stats={stats} />

          <div className="space-y-3">
            <ChargingActionButton
              status={dashboardStatus}
              disabled={!selectedCar || stopping}
              loading={stopping}
              onClick={() => void handleMainAction()}
            />
            <Button
              asChild
              variant="outline"
              size="lg"
              className="h-14 w-full rounded-full border-border bg-white/[0.03] font-heading text-base font-bold"
            >
              <Link href={activeSession ? `/charging/${activeSession.id}` : "/settings"}>
                <SlidersHorizontal className="size-5" aria-hidden />
                Adjust Settings
              </Link>
            </Button>
          </div>

          <Link
            href="/history"
            className="flex items-center justify-between rounded-3xl border border-border bg-white/[0.03] p-4 text-sm text-muted-foreground"
          >
            <span className="inline-flex items-center gap-2">
              <Gauge className="size-5 text-[var(--voltflow-cyan)]" aria-hidden />
              Latest sessions and charge history
            </span>
            <span className="font-semibold text-foreground">Open</span>
          </Link>
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
                inputMode="decimal"
                pattern="[0-9]*"
                min={0}
                max={99}
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
                inputMode="decimal"
                type="number"
                value={targetPct}
                min={Number(startPct) + 1}
                max={100}
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
                type="number"
                inputMode="decimal"
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
                type="number"
                inputMode="decimal"
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
