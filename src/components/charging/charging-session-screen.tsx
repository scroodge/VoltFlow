"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { updateChargingSessionTariff } from "@/actions/sessions";
import { toast } from "sonner";

import { BatteryRing } from "@/components/charging/BatteryRing";
import { ChargingDeltaCard } from "@/components/charging/charging-delta-card";
import {
  ChargingStatsGrid,
  type ChargingStat,
} from "@/components/charging/ChargingStatsGrid";
import {
  useChargingDevLiveOverride,
  useChargingDevSource,
} from "@/components/dev/charging-dev-source-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  costFromGridEnergy,
  deriveChargingState,
  energyFromGridKwh,
  energyNeededKwh,
  formatDuration,
  projectSocAtTime,
  secondsUntilTargetSoc,
  type ChargingParams,
  type DerivedChargingState,
} from "@/lib/charging-math";
import { formatCurrencyAmount, type TranslationKey } from "@/lib/i18n";
import { resolveProviderTariff, resolveTariffTypeByPower } from "@/lib/charging-tariffs";
import { resolveTariffLocationMatch } from "@/lib/charging-gps-location";
import { isDevAppRoute } from "@/lib/dev/dev-fetch";
import { isDevMockChargingSessionId } from "@/lib/dev/build-mock-charging-session";
import { createClient } from "@/lib/supabase/client";
import { mapChargingSession, mapChargingTariffLocation } from "@/lib/db-map";
import { queryKeys } from "@/lib/query-keys";
import { useChargingSessionLiveSync } from "@/hooks/use-charging-session-live-sync";
import { useChargingSessionAutoTariff } from "@/hooks/use-charging-session-auto-tariff";
import { useProviderTariffOverrides } from "@/hooks/use-provider-tariffs-query";
import { useCarsQuery } from "@/hooks/use-cars-query";
import { useSessionQuery } from "@/hooks/use-session-query";
import { useBydmateLiveQuery } from "@/hooks/use-bydmate-live-query";
import { useTickingClock } from "@/hooks/use-ticking-clock";
import { useTranslation } from "@/hooks/use-translation";
import {
  chargingParamsFromSession,
  deriveChargingSessionLiveBundle,
  staticDerivedFromSession,
} from "@/lib/charging-session-sync";
import { deriveLiveChargingState, findFreshChargingSnapshot, snapshotChargePowerKw } from "@/lib/charging-live";
import { useAppPreferences } from "@/stores/use-app-preferences";
import { useAppPath } from "@/lib/dev/dev-path";
import { useChargingUi } from "@/stores/use-charging-ui";
import type {
  ChargingProviderType,
  ChargingSessionRow,
  ChargingTariffType,
} from "@/types/database";

const toParams = chargingParamsFromSession;

const tariffProviderKey = (provider: ChargingProviderType) =>
  `charging.tariff.providers.${provider}` as TranslationKey;

const tariffTypeKey = (tariffType: ChargingTariffType) =>
  `charging.tariff.types.${tariffType}` as TranslationKey;

type ChargingSessionScreenMode = "charging" | "history";

export function ChargingSessionScreen({
  sessionId,
  mode = "charging",
}: {
  sessionId: string;
  mode?: ChargingSessionScreenMode;
}) {
  const qc = useQueryClient();
  const supabase = useMemo(() => createClient(), []);
  const liveDerived = useChargingUi((s) => s.liveDerived);
  const setLiveDerived = useChargingUi((s) => s.setLiveDerived);
  const currency = useAppPreferences((s) => s.currency);
  const defaultPricePerKwh = useAppPreferences((s) => s.defaultPricePerKwh);
  const appPath = useAppPath();
  const { locale, t } = useTranslation();
  const [tariffTypeDraft, setTariffTypeDraft] = useState<ChargingTariffType | null>(null);
  const [priceDraft, setPriceDraft] = useState("");
  const [providerTypeDraft, setProviderTypeDraft] = useState<ChargingProviderType | null>(null);
  const [savingTariff, setSavingTariff] = useState(false);

  const { data: session, error, isLoading } = useSessionQuery(sessionId);
  const { data: carsResult } = useCarsQuery();
  const providerTariffOverrides = useProviderTariffOverrides();
  const { data: bydmateLive = [] } = useBydmateLiveQuery();
  const devSource = useChargingDevSource();
  const devOverrideActive = devSource?.isOverrideActive ?? false;
  const sessionVehicleId = useMemo(
    () =>
      session
        ? (carsResult?.cars?.find((car) => car.id === session.car_id)?.vehicle_alias ?? null)
        : null,
    [carsResult?.cars, session],
  );

  const clockActive = session?.status === "charging";
  const nowMs = useTickingClock(clockActive);
  const effectiveBydmateLive = useChargingDevLiveOverride(bydmateLive, session, nowMs);
  const onLiveDerived = useCallback(
    (derived: ReturnType<typeof staticDerivedFromSession> | null) => {
      setLiveDerived(derived);
    },
    [setLiveDerived],
  );

  useChargingSessionLiveSync({
    session,
    sessionId,
    liveSnapshots: bydmateLive,
    enabled: Boolean(session),
    skipPersist: true,
    resolveLiveSnapshots: devSource?.resolveLiveSnapshots,
    onDerived: onLiveDerived,
  });

  const { data: tariffLocations = [] } = useQuery({
    queryKey: queryKeys.tariffLocations,
    queryFn: async () => {
      if (isDevAppRoute()) return [];
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
    enabled: Boolean(session) && !isDevMockChargingSessionId(sessionId),
  });

  const autoTariffGps = useChargingSessionAutoTariff({
    session,
    sessionId,
    liveSnapshots: bydmateLive,
    vehicleId: sessionVehicleId,
    enabled: Boolean(session) && !isDevMockChargingSessionId(sessionId),
  });

  useEffect(() => {
    setTariffTypeDraft(null);
    setProviderTypeDraft(null);
    setPriceDraft("");
  }, [session?.tariff_type, session?.provider_type, session?.price_per_kwh]);

  useEffect(() => {
    if (isDevAppRoute()) return;

    const channel = supabase
      .channel(`session-live:${sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "charging_sessions",
          filter: `id=eq.${sessionId}`,
        },
        (payload) => {
          const next = payload.new as Record<string, unknown> | null;
          if (!next || typeof next !== "object") return;
          qc.setQueryData(
            queryKeys.session(sessionId),
            mapChargingSession(next),
          );
          qc.invalidateQueries({ queryKey: queryKeys.sessions });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc, sessionId, supabase]);

  const derived: DerivedChargingState | null = useMemo(() => {
    if (!session) return null;
    if (session.status === "charging" && liveDerived) return liveDerived;
    if (session.status === "charging" && session.started_at) {
      const startedAtMs = Date.parse(session.started_at);
      return deriveChargingSessionLiveBundle({
        snapshots: effectiveBydmateLive,
        params: toParams(session),
        startedAtMs,
        nowMs,
      }).display;
    }
    return staticDerivedFromSession(session);
  }, [session, liveDerived, nowMs, effectiveBydmateLive]);

  const displayUsesLiveSoc = useMemo(() => {
    if (!session || session.status !== "charging" || !session.started_at) return false;
    const params = toParams(session);
    const startedAtMs = Date.parse(session.started_at);
    return (
      deriveLiveChargingState({
        snapshot: findFreshChargingSnapshot(effectiveBydmateLive, nowMs),
        params,
        startedAtMs,
        nowMs,
      }) != null
    );
  }, [session, effectiveBydmateLive, nowMs]);

  const freshChargingSnapshot = useMemo(
    () => findFreshChargingSnapshot(effectiveBydmateLive, nowMs),
    [effectiveBydmateLive, nowMs],
  );
  const liveChargePowerKw = useMemo(
    () => snapshotChargePowerKw(freshChargingSnapshot),
    [freshChargingSnapshot],
  );
  // Power display uses the di+ integer (grid-side, matches the car's own display). The BMS
  // float (deriveChargePowerFromEnergyDeltaKw) is cell-side — ~2 kW below the car's reading
  // because of thermal-management draw — so it's misleading here. See AGENTS.md §FINDING.
  const displayAcPowerKw =
    session?.status === "charging"
      ? (liveChargePowerKw ?? session.charger_power_kw ?? 0)
      : (session?.charger_power_kw ?? 0);
  const displayAcPowerDecimals = 1;

  const pctForBar =
    session && derived ? derived.currentPercent : session?.current_percent ?? 0;
  const remainingToTargetPercent =
    session && derived
      ? Math.max(0, session.target_percent - derived.currentPercent)
      : 0;

  const stopSession = useCallback(async () => {
    if (!session?.started_at) return;
    if (isDevMockChargingSessionId(sessionId)) {
      toast.message("Dev preview — session not saved");
      return;
    }
    const now = Date.now();
    const params = toParams(session);
    const startedAtMs = Date.parse(session.started_at);
    const liveSnapshots = devSource?.resolveLiveSnapshots
      ? devSource.resolveLiveSnapshots(bydmateLive, session, now)
      : bydmateLive;
    const d =
      deriveLiveChargingState({
        snapshot: findFreshChargingSnapshot(liveSnapshots, now),
        params,
        startedAtMs,
        nowMs: now,
      }) ?? deriveChargingState(params, startedAtMs, now);

    const { error: upErr } = await supabase
      .from("charging_sessions")
      .update({
        current_percent: d.currentPercent,
        charged_energy_kwh: d.chargedEnergyKwh,
        estimated_cost: d.estimatedCost,
        status: "stopped",
        stopped_at: new Date().toISOString(),
      })
      .eq("id", sessionId);

    if (upErr) {
      toast.error(upErr.message);
      return;
    }

    qc.setQueryData(queryKeys.session(sessionId), {
      ...session,
      current_percent: d.currentPercent,
      charged_energy_kwh: d.chargedEnergyKwh,
      estimated_cost: d.estimatedCost,
      status: "stopped",
      stopped_at: new Date().toISOString(),
    });
    qc.invalidateQueries({ queryKey: queryKeys.sessions });
    toast.message(t("charging.saved") as string);
  }, [bydmateLive, devSource, qc, session, sessionId, supabase, t]);

  const saveTariff = useCallback(async () => {
    if (!session) return;
    const effectivePriceDraft =
      priceDraft.trim() === ""
        ? String(session.price_per_kwh > 0 ? session.price_per_kwh : defaultPricePerKwh)
        : priceDraft;
    const pricePerKwh = Number.parseFloat(effectivePriceDraft.replace(",", "."));
    if (!Number.isFinite(pricePerKwh) || pricePerKwh < 0) {
      toast.error(t("charging.tariff.invalidPrice") as string);
      return;
    }
    setSavingTariff(true);
    const res = await updateChargingSessionTariff({
      sessionId,
      tariffType: tariffTypeDraft ?? session.tariff_type,
      providerType: providerTypeDraft ?? session.provider_type,
      pricePerKwh,
    });
    setSavingTariff(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    await qc.invalidateQueries({ queryKey: queryKeys.session(sessionId) });
    await qc.invalidateQueries({ queryKey: queryKeys.sessions });
    toast.success(t("charging.tariff.updated") as string);
  }, [defaultPricePerKwh, priceDraft, providerTypeDraft, qc, session, sessionId, t, tariffTypeDraft]);

  const applyProviderPresetPrice = useCallback(
    (provider: ChargingProviderType, tariffType: ChargingTariffType) => {
      if (provider === "custom") return;
      const preset = resolveProviderTariff(provider, providerTariffOverrides);
      setPriceDraft(String(preset[tariffType]));
    },
    [providerTariffOverrides],
  );

  const tariffLocationMatch = useMemo(
    () => resolveTariffLocationMatch(autoTariffGps.activeLocation, tariffLocations),
    [autoTariffGps.activeLocation, tariffLocations],
  );
  const powerTariffFallback = resolveTariffTypeByPower(displayAcPowerKw);

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-5 p-4">
        <div className="h-10 w-2/5 rounded-xl bg-white/5" />
        <div className="voltflow-card h-44" />
        <div className="grid grid-cols-2 gap-3">
          <div className="voltflow-card h-[92px]" />
          <div className="voltflow-card h-[92px]" />
          <div className="voltflow-card h-[92px]" />
          <div className="voltflow-card h-[92px]" />
        </div>
        <div className="h-14 rounded-full bg-white/10" />
      </div>
    );
  }

  if (error || !session || !derived) {
    return (
      <div className="flex flex-col gap-6 p-4">
        <p className="text-muted-foreground">{t("charging.unavailable")}</p>
        <Button asChild size="lg" className="min-h-[48px] text-base">
          <Link href={appPath("/dashboard")}>{t("charging.backHome")}</Link>
        </Button>
      </div>
    );
  }

  const charging = session.status === "charging";
  const historyMode = mode === "history";
  const avgPowerKw = !charging && derived && derived.elapsedSeconds > 0
    ? (session?.charged_energy_kwh ?? 0) / (derived.elapsedSeconds / 3600)
    : 0;
  const effectivePricePerKwh =
    session.price_per_kwh > 0 ? session.price_per_kwh : defaultPricePerKwh;
  const effectiveTariffTypeDraft = tariffTypeDraft ?? session.tariff_type;
  const effectiveProviderTypeDraft = providerTypeDraft ?? session.provider_type;
  const effectivePriceDraft =
    priceDraft.trim() === ""
      ? String(session.price_per_kwh > 0 ? session.price_per_kwh : defaultPricePerKwh)
      : priceDraft;
  const displayCurrentCost =
    effectivePricePerKwh > 0
      ? formatCurrencyAmount(
          currency,
          costFromGridEnergy(derived.chargedEnergyKwh, effectivePricePerKwh),
          locale,
        )
      : "—";
  const displayCostAtFull =
    effectivePricePerKwh > 0
      ? formatCurrencyAmount(
          currency,
          costFromGridEnergy(
            energyFromGridKwh(
              energyNeededKwh(
                session.battery_capacity_kwh,
                session.start_percent,
                100,
              ),
              session.efficiency_percent,
            ),
            effectivePricePerKwh,
          ),
          locale,
        )
      : "—";
  const displayFinalCost =
    session.estimated_cost > 0
      ? formatCurrencyAmount(currency, session.estimated_cost, locale)
      : "—";

  const chargeParams = toParams(session);
  const startedAtMs = session.started_at ? Date.parse(session.started_at) : null;
  const estimatedFinishMs =
    charging && derived.remainingSeconds > 0 ? nowMs + derived.remainingSeconds * 1000 : null;
  const morningTargetMs = (() => {
    const anchor = new Date(nowMs);
    anchor.setHours(7, 0, 0, 0);
    if (anchor.getTime() <= nowMs) anchor.setDate(anchor.getDate() + 1);
    return anchor.getTime();
  })();
  const projectedSocAtMorning =
    charging && startedAtMs != null
      ? projectSocAtTime(chargeParams, startedAtMs, morningTargetMs)
      : null;
  const secondsToTarget =
    charging && derived.currentPercent != null
      ? secondsUntilTargetSoc(chargeParams, derived.currentPercent)
      : null;

  const localeCode =
    locale === "be" ? "be-BY" : locale === "ru" ? "ru-RU" : "en-US";
  const chargingStats: ChargingStat[] = [
    {
      label: historyMode ? (t("history.duration") as string) : (t("charging.elapsed") as string),
      value: formatDuration(derived.elapsedSeconds),
    },
    ...(!historyMode
      ? [
          {
            label: t("charging.remaining") as string,
            value: charging ? formatDuration(derived.remainingSeconds) : "—",
            accent: "cyan" as const,
          },
        ]
      : []),
    {
      label: t("charging.energyDelivered") as string,
      value: `${derived.chargedEnergyKwh.toFixed(2)} kWh`,
      accent: "green",
    },
    ...(historyMode
      ? [
          {
            label: t("charging.finalCost") as string,
            value: displayFinalCost,
          },
        ]
      : [
          {
            label: t("charging.currentCost") as string,
            value: displayCurrentCost,
          },
          {
            label: t("charging.fullCost") as string,
            value: displayCostAtFull,
          },
        ]),
    {
      label: historyMode ? (t("charging.avgPower") as string) : (t("charging.acPower") as string),
      value: historyMode
        ? `${avgPowerKw.toFixed(2)} kW`
        : `${displayAcPowerKw.toFixed(displayAcPowerDecimals)} kW`,
      accent: "blue",
    },
  ];

  if (!historyMode && charging && estimatedFinishMs != null) {
    chargingStats.push({
      label: t("charging.estimatedFinish") as string,
      value: new Date(estimatedFinishMs).toLocaleTimeString(localeCode, {
        hour: "2-digit",
        minute: "2-digit",
      }),
      accent: "cyan",
    });
  }
  if (!historyMode && charging && projectedSocAtMorning != null) {
    chargingStats.push({
      label: t("charging.projectedAtSeven") as string,
      value: `${projectedSocAtMorning.toFixed(1)}%`,
    });
  }
  if (!historyMode && charging && secondsToTarget != null && secondsToTarget > 0) {
    chargingStats.push({
      label: t("charging.secondsToTarget") as string,
      value: formatDuration(secondsToTarget),
    });
  }

  return (
    <div className="flex flex-1 flex-col gap-5 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {historyMode ? t("history.eyebrow") : t("charging.live")}
          </p>
          <h1 className="mt-1 font-heading text-2xl font-bold tracking-normal text-balance">
            {historyMode ? t("history.detail") : t("charging.session")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {charging && !historyMode
              ? t("charging.updating")
              : historyMode
                ? t("history.subtitle")
                : t("charging.frozen")}
          </p>
        </div>
        <Button
          asChild
          variant="outline"
          size="lg"
          className="min-h-[44px] rounded-full border-border bg-white/[0.03] font-heading text-sm font-bold"
        >
          <Link href={appPath(historyMode ? "/history?tab=charging" : "/dashboard")}>
            {historyMode ? (locale === "ru" ? "Назад" : "Back") : t("charging.dashboard")}
          </Link>
        </Button>
      </div>

      <section className="voltflow-card relative px-4 py-5">
        {charging && !historyMode ? (
          <span
            className={
              "absolute right-3 top-3 max-w-[9.5rem] rounded-lg px-2 py-0.5 text-right text-[8px] font-semibold leading-snug tracking-normal " +
              (displayUsesLiveSoc
                ? "text-[var(--voltflow-cyan)]"
                : "text-muted-foreground")
            }
          >
            {displayUsesLiveSoc
              ? (t("charging.socSourceLive") as string)
              : (t("charging.socSourceEstimate") as string)}
          </span>
        ) : null}

        <BatteryRing
          size="compact"
          percent={pctForBar}
          status={`${session.start_percent.toFixed(0)}% → ${session.target_percent.toFixed(0)}%`}
          charging={charging && !historyMode}
          className="mx-auto max-w-[132px]"
        />

        <p className="mt-1 text-center text-[11px] text-muted-foreground tabular-nums">
          {t("charging.remainingToTarget", {
            pct: remainingToTargetPercent.toFixed(0),
          })}
        </p>
      </section>

      <ChargingStatsGrid stats={chargingStats} />

      <section className="voltflow-card space-y-3 p-4">
        <p className="text-sm font-semibold tracking-tight">
          {historyMode
            ? (t("charging.tariff.historyCorrection") as string)
            : (t("charging.tariff.whileCharging") as string)}
        </p>
        {!historyMode && charging && !session.tariff_manual ? (
          <p className="text-muted-foreground text-xs">
            {t("charging.tariff.autoMatchHint") as string}
          </p>
        ) : null}
        {!historyMode && charging && session.tariff_manual ? (
          <p className="text-xs text-amber-200/90">
            {t("charging.tariff.pinnedManual") as string}
          </p>
        ) : null}
        {!historyMode && charging && tariffLocationMatch ? (
          <p className="rounded-xl border border-[var(--voltflow-green)]/30 bg-[var(--voltflow-green)]/10 px-3 py-2 text-xs text-[var(--voltflow-green)]">
            {t("charging.tariff.matchedLocation", {
              name: tariffLocationMatch.preset.name,
              distance: Math.round(tariffLocationMatch.distanceM),
              provider: t(tariffProviderKey(tariffLocationMatch.preset.provider_type)) as string,
              tariffType: t(tariffTypeKey(tariffLocationMatch.preset.tariff_type)) as string,
            })}
            {autoTariffGps.gpsSource === "browser"
              ? (t("charging.tariff.phoneGpsFallback") as string)
              : ""}
          </p>
        ) : null}
        {!historyMode && charging && !tariffLocationMatch && autoTariffGps.activeLocation ? (
          <p className="text-xs text-muted-foreground">
            {t("charging.tariff.noMatchInRadius", {
              tariffType: t(tariffTypeKey(powerTariffFallback)) as string,
              power: displayAcPowerKw.toFixed(displayAcPowerDecimals),
            })}
          </p>
        ) : null}
        {!historyMode && charging && !autoTariffGps.activeLocation ? (
          <p className="text-xs text-muted-foreground">
            {t("charging.tariff.waitingGps") as string}
          </p>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="session-provider-type">{t("charging.tariff.provider") as string}</Label>
            <Select
              value={effectiveProviderTypeDraft}
              onValueChange={(value) => {
                const provider = value as ChargingProviderType;
                setProviderTypeDraft(provider);
                applyProviderPresetPrice(provider, effectiveTariffTypeDraft);
              }}
              modal={false}
              items={(
                [
                  "home",
                  "malanka",
                  "evika",
                  "forevo",
                  "zaryadka",
                  "batterfly",
                  "custom",
                ] as const
              ).map((value) => ({
                value,
                label: t(tariffProviderKey(value)),
              }))}
            >
              <SelectTrigger id="session-provider-type" className="h-11 w-full rounded-2xl text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="z-[200]">
                {(["home", "malanka", "evika", "forevo", "zaryadka", "batterfly", "custom"] as const).map(
                  (value) => (
                    <SelectItem key={value} value={value}>
                      {t(tariffProviderKey(value))}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="session-tariff-type">{t("charging.tariff.type") as string}</Label>
            <Select
              value={effectiveTariffTypeDraft}
              onValueChange={(value) => {
                const tariffType = value as ChargingTariffType;
                setTariffTypeDraft(tariffType);
                applyProviderPresetPrice(effectiveProviderTypeDraft, tariffType);
              }}
              modal={false}
              items={(["home", "commercial_ac", "fast_dc"] as const).map((value) => ({
                value,
                label: t(tariffTypeKey(value)),
              }))}
            >
              <SelectTrigger id="session-tariff-type" className="h-11 w-full rounded-2xl text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="z-[200]">
                {(["home", "commercial_ac", "fast_dc"] as const).map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(tariffTypeKey(value))}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="session-tariff-price">{t("charging.tariff.pricePerKwh") as string}</Label>
            <Input
              id="session-tariff-price"
              inputMode="decimal"
              value={effectivePriceDraft}
              onChange={(event) => setPriceDraft(event.target.value)}
              className="h-11 rounded-2xl text-sm"
            />
          </div>
        </div>
        <Button
          type="button"
          variant="secondary"
          className="h-11 w-full rounded-full text-sm font-semibold"
          disabled={savingTariff}
          onClick={() => void saveTariff()}
        >
          {savingTariff ? (t("common.saving") as string) : (t("charging.tariff.save") as string)}
        </Button>
      </section>

      <ChargingDeltaCard session={session} vehicleId={sessionVehicleId ?? undefined} />

      {!historyMode && (
        <div className="mt-auto space-y-3">
          <Button
            type="button"
            size="lg"
            variant="destructive"
            disabled={!charging}
            className="h-14 w-full rounded-full font-heading text-base font-bold tracking-wide"
            onClick={() => void stopSession()}
          >
            {t("charging.stop")}
          </Button>
          {!charging && (
            <p className="text-muted-foreground text-center text-sm">
              {session.status === "completed"
                ? t("charging.complete")
                : t("charging.paused")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
