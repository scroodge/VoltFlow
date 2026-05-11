"use client";

import { format } from "date-fns";
import { be, ru } from "date-fns/locale";

import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { deriveChargingState, formatDuration, type ChargingParams } from "@/lib/charging-math";
import { formatCurrencyAmount } from "@/lib/i18n";
import { useTickingClock } from "@/hooks/use-ticking-clock";
import { useSessionsQuery } from "@/hooks/use-sessions-query";
import { useTranslation } from "@/hooks/use-translation";
import { useAppPreferences } from "@/stores/use-app-preferences";
import type { ChargingSessionRow } from "@/types/database";

export function HistoryView() {
  const { data, isLoading } = useSessionsQuery();
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4 p-6">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-32 rounded-3xl" />
        ))}
      </div>
    );
  }

  if (!data?.length) {
    return (
      <EmptyState />
    );
  }

  const finishedFirst = [...data].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  );

  return (
    <div className="flex flex-col gap-5 p-6">
      <div>
        <p className="text-muted-foreground text-xs uppercase tracking-[0.35em]">
          {t("history.eyebrow")}
        </p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight">{t("history.title")}</h1>
        <p className="text-muted-foreground mt-3 max-w-xl text-lg">
          {t("history.subtitle")}
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {finishedFirst.map((session) => (
          <HistoryCard key={session.id} session={session} />
        ))}
      </div>
    </div>
  );
}

function HistoryCard({ session }: { session: ChargingSessionRow }) {
  const nowMs = useTickingClock(session.status === "charging");
  const { locale, t } = useTranslation();
  const currency = useAppPreferences((s) => s.currency);
  const started = session.started_at ? new Date(session.started_at) : null;
  const ended = session.stopped_at ? new Date(session.stopped_at) : null;

  const params: ChargingParams = {
    startPercent: session.start_percent,
    targetPercent: session.target_percent,
    batteryCapacityKwh: session.battery_capacity_kwh,
    chargerPowerKw: session.charger_power_kw,
    efficiencyPercent: session.efficiency_percent,
    pricePerKwh: session.price_per_kwh,
  };

  const derived =
    session.status === "charging" && session.started_at
      ? deriveChargingState(params, Date.parse(session.started_at), nowMs)
      : null;

  const pct =
    derived?.currentPercent.toFixed(1) ?? session.current_percent.toFixed(1);
  const elapsed =
    derived && session.status === "charging"
      ? formatDuration(derived.elapsedSeconds)
      : ended && started
        ? formatDuration((ended.getTime() - started.getTime()) / 1000)
        : "—";

  const statusTone =
    session.status === "completed"
      ? "text-teal-200"
      : session.status === "stopped"
        ? "text-yellow-300"
      : session.status === "charging"
        ? "text-primary"
      : "text-muted-foreground";
  const dateLocale = locale === "be" ? be : locale === "ru" ? ru : undefined;
  const statusLabel =
    session.status === "completed"
      ? t("history.status.completed")
      : session.status === "stopped"
        ? t("history.status.stopped")
        : session.status === "charging"
          ? t("history.status.charging")
          : session.status;

  return (
    <Card className="border-white/[0.08] bg-gradient-to-br from-background via-card to-primary/13">
      <CardContent className="flex flex-col gap-4 px-6 py-6">
        <div className="flex items-start justify-between gap-6">
          <div>
            <p className="text-muted-foreground text-xs uppercase tracking-[0.32em]">
              {started
                ? format(started, "EEEE · HH:mm · MMM d", {
                    locale: dateLocale,
                  })
                : t("history.queued")}
            </p>
            <p className="mt-6 text-[40px] font-semibold tracking-tighter tabular-nums">
              {pct}
              %
            </p>
          </div>
          <span
            className={`rounded-full px-6 py-2 text-xs font-semibold uppercase tracking-[0.32em] ${statusTone}`}
          >
            {statusLabel}
          </span>
        </div>
        <dl className="border-white/[0.05] divide-y divide-white/5 text-lg">
          <Row label={t("history.target") as string} value={`${session.target_percent}%`} />
          <Row
            label={t("history.energy") as string}
            value={`${(derived?.chargedEnergyKwh ?? session.charged_energy_kwh).toFixed(
              2,
            )} kWh`}
          />
          <Row
            label={t("history.cost") as string}
            value={
              session.price_per_kwh > 0
                ? formatCurrencyAmount(
                    currency,
                    derived?.estimatedCost ?? session.estimated_cost,
                    locale,
                  )
                : "—"
            }
          />
          <Row label={t("history.duration") as string} value={elapsed} />
        </dl>

        <div className="mt-10 flex gap-5">
          <Link
            className="text-primary text-lg font-semibold underline-offset-4 hover:underline"
            href={`/charging/${session.id}`}
          >
            {t("history.detail")}
          </Link>
          <Link
            className="text-muted-foreground text-lg underline-offset-4 hover:text-foreground hover:underline"
            href="/dashboard"
          >
            {t("history.startAnother")}
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-6">
      <dt className="text-muted-foreground text-base">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function EmptyState() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-1 flex-col items-center gap-12 px-6 py-28 text-center">
      <div className="space-y-8">
        <p className="text-muted-foreground text-xs uppercase tracking-[0.4em]">
          {t("history.emptyEyebrow")}
        </p>
        <h1 className="text-balance text-4xl font-semibold tracking-tight">
          {t("history.emptyTitle")}
        </h1>
        <p className="text-muted-foreground mx-auto max-w-md text-lg">
          {t("history.emptyBody")}
        </p>
      </div>
      <Link
        className="text-primary underline-offset-[8px] text-lg hover:underline"
        href="/dashboard"
      >
        {t("history.headCockpit")}
      </Link>
    </div>
  );
}
