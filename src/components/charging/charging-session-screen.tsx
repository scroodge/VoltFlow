"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useCallback, useEffect, useMemo } from "react";
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
import { formatCurrencyAmount } from "@/lib/i18n";
import { isDevAppRoute } from "@/lib/dev/dev-fetch";
import { isDevMockChargingSessionId } from "@/lib/dev/build-mock-charging-session";
import { createClient } from "@/lib/supabase/client";
import { mapChargingSession } from "@/lib/db-map";
import { queryKeys } from "@/lib/query-keys";
import { useChargingSessionLiveSync } from "@/hooks/use-charging-session-live-sync";
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
import { deriveLiveChargingState, findFreshChargingSnapshot } from "@/lib/charging-live";
import { useAppPreferences } from "@/stores/use-app-preferences";
import { useAppPath } from "@/lib/dev/dev-path";
import { useChargingUi } from "@/stores/use-charging-ui";
import type { ChargingSessionRow } from "@/types/database";

const toParams = chargingParamsFromSession;

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

  const { data: session, error, isLoading } = useSessionQuery(sessionId);
  const { data: carsResult } = useCarsQuery();
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

  const pctForBar =
    session && derived ? derived.currentPercent : session?.current_percent ?? 0;
  const pctToTarget =
    session && derived
      ? Math.min(
          100,
          Math.max(
            0,
            ((derived.currentPercent - session.start_percent) /
              Math.max(session.target_percent - session.start_percent, 0.001)) *
              100,
          ),
        )
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
  const effectivePricePerKwh =
    session.price_per_kwh > 0 ? session.price_per_kwh : defaultPricePerKwh;
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
      label: t("charging.elapsed") as string,
      value: formatDuration(derived.elapsedSeconds),
    },
    {
      label: t("charging.remaining") as string,
      value: charging ? formatDuration(derived.remainingSeconds) : "—",
      accent: "cyan",
    },
    {
      label: t("charging.energyDelivered") as string,
      value: `${derived.chargedEnergyKwh.toFixed(2)} kWh`,
      accent: "green",
    },
    {
      label: t("charging.currentCost") as string,
      value: displayCurrentCost,
    },
    {
      label: t("charging.fullCost") as string,
      value: displayCostAtFull,
    },
    {
      label: t("charging.acPower") as string,
      value: `${session.charger_power_kw.toFixed(1)} kW`,
      accent: "blue",
    },
    {
      label: t("charging.batteryPack") as string,
      value: `${session.battery_capacity_kwh} kWh`,
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
          <Link href={appPath(historyMode ? "/history" : "/dashboard")}>
            {historyMode ? t("history.title") : t("charging.dashboard")}
          </Link>
        </Button>
      </div>

      <section className="voltflow-card relative px-4 py-5">
        {charging && !historyMode ? (
          <span
            className={
              "absolute right-3 top-3 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] " +
              (displayUsesLiveSoc
                ? "text-[var(--voltflow-cyan)]"
                : "text-muted-foreground")
            }
          >
            {displayUsesLiveSoc ? "Mate" : "Est."}
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
          {t("charging.segment", { pct: pctToTarget.toFixed(0) })}
        </p>
      </section>

      <ChargingStatsGrid stats={chargingStats} />

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
