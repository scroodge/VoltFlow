"use client";

import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  deriveChargingState,
  formatDuration,
  type ChargingParams,
  type DerivedChargingState,
} from "@/lib/charging-math";
import { formatCurrencyAmount } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/client";
import { mapChargingSession } from "@/lib/db-map";
import { queryKeys } from "@/lib/query-keys";
import { fetchSessionById, useSessionQuery } from "@/hooks/use-session-query";
import { useTickingClock } from "@/hooks/use-ticking-clock";
import { useTranslation } from "@/hooks/use-translation";
import { useAppPreferences } from "@/stores/use-app-preferences";
import { useChargingUi } from "@/stores/use-charging-ui";
import type { ChargingSessionRow } from "@/types/database";

function toParams(row: ChargingSessionRow): ChargingParams {
  return {
    startPercent: row.start_percent,
    targetPercent: row.target_percent,
    batteryCapacityKwh: row.battery_capacity_kwh,
    chargerPowerKw: row.charger_power_kw,
    efficiencyPercent: row.efficiency_percent,
    pricePerKwh: row.price_per_kwh,
  };
}

export function ChargingSessionScreen({ sessionId }: { sessionId: string }) {
  const qc = useQueryClient();
  const supabase = useMemo(() => createClient(), []);
  const liveDerived = useChargingUi((s) => s.liveDerived);
  const setLiveDerived = useChargingUi((s) => s.setLiveDerived);
  const currency = useAppPreferences((s) => s.currency);
  const { locale, t } = useTranslation();

  const { data: session, error, isLoading } = useSessionQuery(sessionId);
  const completingRef = useRef(false);

  useEffect(() => {
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

  useEffect(() => {
    if (!session) {
      setLiveDerived(null);
      completingRef.current = false;
      return;
    }

    if (session.status !== "charging" || !session.started_at) {
      setLiveDerived({
        currentPercent: session.current_percent,
        chargedEnergyKwh: session.charged_energy_kwh,
        estimatedCost: session.estimated_cost,
        elapsedSeconds: session.started_at
          ? (Date.now() - Date.parse(session.started_at)) / 1000
          : 0,
        remainingSeconds: 0,
        isComplete: session.status === "completed",
      });
      completingRef.current = false;
      return;
    }

    let lastPush = 0;
    completingRef.current = false;

    const tick = async () => {
      const now = Date.now();
      let row = qc.getQueryData<ChargingSessionRow>(
        queryKeys.session(sessionId),
      );
      if (!row?.started_at) {
        row = await fetchSessionById(sessionId);
        qc.setQueryData(queryKeys.session(sessionId), row);
      }
      if (!row || row.status !== "charging" || !row.started_at) return;

      const d = deriveChargingState(
        toParams(row),
        Date.parse(row.started_at),
        now,
      );
      setLiveDerived(d);

      if (d.isComplete && !completingRef.current) {
        completingRef.current = true;
        const { error: upErr } = await supabase
          .from("charging_sessions")
          .update({
            current_percent: d.currentPercent,
            charged_energy_kwh: d.chargedEnergyKwh,
            estimated_cost: d.estimatedCost,
            status: "completed",
            stopped_at: new Date().toISOString(),
          })
          .eq("id", sessionId);

        if (upErr) {
          completingRef.current = false;
          toast.error(upErr.message);
          return;
        }

        qc.setQueryData(
          queryKeys.session(sessionId),
          (old) =>
            old
              ? {
                  ...old,
                  current_percent: d.currentPercent,
                  charged_energy_kwh: d.chargedEnergyKwh,
                  estimated_cost: d.estimatedCost,
                  status: "completed",
                  stopped_at: new Date().toISOString(),
                }
              : old,
        );

        qc.invalidateQueries({ queryKey: queryKeys.sessions });
        toast.success(t("charging.targetReached") as string);
        return;
      }

      if (now - lastPush >= 950) {
        lastPush = now;
        await supabase
          .from("charging_sessions")
          .update({
            current_percent: d.currentPercent,
            charged_energy_kwh: d.chargedEnergyKwh,
            estimated_cost: d.estimatedCost,
          })
          .eq("id", sessionId);
      }
    };

    void tick();
    const interval = window.setInterval(() => void tick(), 1000);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- interval reads fresh rows from React Query; full `session` would thrash the timer on every write
  }, [
    qc,
    session?.id,
    session?.status,
    session?.started_at,
    sessionId,
    setLiveDerived,
    supabase,
  ]);

  const clockActive = session?.status === "charging";
  const nowMs = useTickingClock(clockActive);

  const derived: DerivedChargingState | null = useMemo(() => {
    if (!session) return null;
    if (session.status === "charging" && liveDerived) return liveDerived;
    if (session.status === "charging" && session.started_at) {
      return deriveChargingState(
        toParams(session),
        Date.parse(session.started_at),
        nowMs,
      );
    }
    const startedMs = session.started_at ? Date.parse(session.started_at) : null;
    const stoppedMs = session.stopped_at ? Date.parse(session.stopped_at) : null;
    const elapsedSeconds =
      startedMs != null && stoppedMs != null
        ? (stoppedMs - startedMs) / 1000
        : 0;
    return {
      currentPercent: session.current_percent,
      chargedEnergyKwh: session.charged_energy_kwh,
      estimatedCost: session.estimated_cost,
      elapsedSeconds,
      remainingSeconds: 0,
      isComplete: session.status === "completed",
    } satisfies DerivedChargingState;
  }, [session, liveDerived, nowMs]);

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
    const d = deriveChargingState(
      toParams(session),
      Date.parse(session.started_at),
      Date.now(),
    );

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
  }, [qc, session, sessionId, supabase, t]);

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
          <Link href="/dashboard">{t("charging.backHome")}</Link>
        </Button>
      </div>
    );
  }

  const charging = session.status === "charging";

  return (
    <div className="flex flex-1 flex-col gap-5 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-muted-foreground text-xs uppercase tracking-widest">
            {t("charging.live")}
          </p>
          <h1 className="mt-2 text-xl font-semibold tracking-tight text-balance">
            {t("charging.session")}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {charging ? t("charging.updating") : t("charging.frozen")}
          </p>
        </div>
        <Button asChild variant="outline" size="lg" className="min-h-[44px]">
          <Link href="/dashboard">{t("charging.dashboard")}</Link>
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
          label={t("charging.estimatedCost") as string}
          value={
            session.price_per_kwh > 0
              ? formatCurrencyAmount(currency, derived.estimatedCost, locale)
              : "—"
          }
        />
      </div>

      <CardRow
        label={t("charging.acPower") as string}
        value={`${session.charger_power_kw.toFixed(1)} kW`}
      />
      <CardRow label={t("charging.batteryPack") as string} value={`${session.battery_capacity_kwh} kWh`} />

      <div className="mt-auto sticky bottom-[calc(env(safe-area-inset-bottom)+6rem)] z-40 space-y-3">
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

function CardRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card flex min-h-[56px] items-center justify-between rounded-2xl border border-white/[0.08] px-5 py-4">
      <span className="text-muted-foreground text-sm">{label}</span>
      <span className="text-lg font-semibold tabular-nums">{value}</span>
    </div>
  );
}
