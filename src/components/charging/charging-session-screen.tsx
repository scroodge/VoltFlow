"use client";

import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import Link from "next/link";
import { useCallback, useEffect, useMemo } from "react";
import { toast } from "sonner";

import { ChargingDeltaCard } from "@/components/charging/charging-delta-card";
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
  const appPath = useAppPath();
  const { locale, t } = useTranslation();

  const { data: session, error, isLoading } = useSessionQuery(sessionId);
  const { data: bydmateLive = [] } = useBydmateLiveQuery();
  const devSource = useChargingDevSource();
  const devOverrideActive = devSource?.isOverrideActive ?? false;

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
      <div className="animate-pulse space-y-6 p-4">
        <div className="h-40 rounded-3xl bg-white/5" />
        <div className="h-36 rounded-3xl bg-white/5" />
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
  const costAtFull =
    session.price_per_kwh > 0
      ? costFromGridEnergy(
          energyFromGridKwh(
            energyNeededKwh(
              session.battery_capacity_kwh,
              session.start_percent,
              100,
            ),
            session.efficiency_percent,
          ),
          session.price_per_kwh,
        )
      : null;

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

  return (
    <div className="flex flex-1 flex-col gap-5 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-muted-foreground text-xs uppercase tracking-widest">
            {historyMode ? t("history.eyebrow") : t("charging.live")}
          </p>
          <h1 className="mt-2 text-xl font-semibold tracking-tight text-balance">
            {historyMode ? t("history.detail") : t("charging.session")}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {charging && !historyMode
              ? t("charging.updating")
              : historyMode
                ? t("history.subtitle")
                : t("charging.frozen")}
          </p>
        </div>
        <Button asChild variant="outline" size="lg" className="min-h-[44px]">
          <Link href={appPath(historyMode ? "/history" : "/dashboard")}>
            {historyMode ? t("history.title") : t("charging.dashboard")}
          </Link>
        </Button>
      </div>

      <motion.div
        animate={
          charging
            ? { boxShadow: "0 0 40px oklch(0.72 0.17 173 / 0.22)" }
            : { boxShadow: "0 12px 30px rgb(0 0 0 / 0.18)" }
        }
        transition={{ duration: 1.8, repeat: charging ? Infinity : 0 }}
        className="bg-card relative overflow-hidden rounded-[2rem] border border-white/[0.08] px-6 py-8"
      >
        <motion.div
          aria-hidden
          className="from-primary pointer-events-none absolute inset-0 bg-gradient-to-br to-transparent opacity-15"
          animate={{ opacity: charging ? [0.12, 0.22, 0.12] : 0.08 }}
          transition={{ duration: 3.2, repeat: charging ? Infinity : 0 }}
        />
        <div className="relative flex flex-col items-center gap-2">
          <span className="text-muted-foreground text-sm font-medium">
            {t("charging.battery")}
          </span>
          <motion.span
            className="text-primary drop-shadow-[0_0_32px_oklch(0.75_0.15_173_/_0.35)] text-7xl font-semibold tracking-tighter tabular-nums"
            key={Math.round(pctForBar * 100) / 100}
            initial={{ opacity: 0.6, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
          >
            {pctForBar.toFixed(1)}%
          </motion.span>
          <p className="text-muted-foreground text-sm tabular-nums">
            {t("charging.goal", {
              target: session.target_percent.toFixed(0),
              start: session.start_percent.toFixed(0),
            })}
          </p>
          {charging && !historyMode ? (
            <span
              className={
                "mt-1 rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] " +
                (displayUsesLiveSoc
                  ? "border border-cyan-400/30 bg-cyan-400/10 text-cyan-100"
                  : "border border-white/10 bg-white/[0.04] text-muted-foreground")
              }
            >
              {displayUsesLiveSoc ? "Mate SOC" : "Estimate"}
            </span>
          ) : null}
        </div>

        <div className="relative mt-8">
          <div className="h-4 rounded-full bg-white/10 shadow-inner overflow-hidden">
            <motion.div
              className="from-primary bg-gradient-to-r to-teal-200 h-full rounded-full shadow-[inset_0_1px_0_rgb(255_255_255/0.2)]"
              initial={false}
              animate={{ width: `${pctForBar}%` }}
              transition={{ type: "spring", stiffness: 120, damping: 20 }}
              layout
            />
          </div>
          <p className="text-muted-foreground mt-3 text-xs">
            {t("charging.segment", { pct: pctToTarget.toFixed(0) })}
          </p>
        </div>
      </motion.div>

      <div className="grid grid-cols-2 gap-3">
        <StatCard label={t("charging.elapsed") as string} value={formatDuration(derived.elapsedSeconds)} />
        <StatCard
          label={t("charging.remaining") as string}
          value={charging ? formatDuration(derived.remainingSeconds) : "—"}
        />
        <StatCard
          label={t("charging.energyDelivered") as string}
          value={`${derived.chargedEnergyKwh.toFixed(2)} kWh`}
        />
        <StatCard
          label={t("charging.currentCost") as string}
          value={
            session.price_per_kwh > 0
              ? formatCurrencyAmount(currency, derived.estimatedCost, locale)
              : "—"
          }
        />
        <StatCard
          label={t("charging.fullCost") as string}
          value={
            costAtFull != null
              ? formatCurrencyAmount(currency, costAtFull, locale)
              : "—"
          }
        />
        <StatCard
          label={t("charging.acPower") as string}
          value={`${session.charger_power_kw.toFixed(1)} kW`}
        />
        <StatCard
          label={t("charging.batteryPack") as string}
          value={`${session.battery_capacity_kwh} kWh`}
        />
        {!historyMode && charging && estimatedFinishMs != null ? (
          <StatCard
            label={t("charging.estimatedFinish") as string}
            value={new Date(estimatedFinishMs).toLocaleTimeString(
              locale === "be" ? "be-BY" : locale === "ru" ? "ru-RU" : "en-US",
              { hour: "2-digit", minute: "2-digit" },
            )}
          />
        ) : null}
        {!historyMode && charging && projectedSocAtMorning != null ? (
          <StatCard
            label={t("charging.projectedAtSeven") as string}
            value={`${projectedSocAtMorning.toFixed(1)}%`}
          />
        ) : null}
        {!historyMode && charging && secondsToTarget != null && secondsToTarget > 0 ? (
          <StatCard
            label={t("charging.secondsToTarget") as string}
            value={formatDuration(secondsToTarget)}
          />
        ) : null}
      </div>

      <ChargingDeltaCard session={session} />

      {!historyMode && (
        <div className="mt-auto space-y-3">
          <Button
            type="button"
            size="lg"
            variant="destructive"
            disabled={!charging}
            className="h-14 w-full rounded-full text-base font-semibold tracking-wide"
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

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card rounded-3xl border border-white/[0.08] p-5 shadow-inner">
      <p className="text-muted-foreground text-xs uppercase tracking-[0.2em]">
        {label}
      </p>
      <p className="mt-3 text-xl font-semibold tabular-nums tracking-tight">
        {value}
      </p>
    </div>
  );
}
