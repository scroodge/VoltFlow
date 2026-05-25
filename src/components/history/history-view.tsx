"use client";

import { useId, useMemo } from "react";
import { format } from "date-fns";
import { be, ru } from "date-fns/locale";

import Link from "next/link";

import { BrandBadge } from "@/components/brand/BrandBadge";
import { LogoFull } from "@/components/brand/LogoFull";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useBydmateChargingSessionSamplesQuery, type ChargingSessionTelemetrySample } from "@/hooks/use-bydmate-charging-session-samples-query";
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
      <div className="safe-bottom flex flex-col gap-4 px-4 pb-6 pt-5">
        <header className="flex items-center justify-between gap-4">
          <LogoFull />
          <BrandBadge className="hidden min-[380px]:inline-flex">Session log</BrandBadge>
        </header>
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-32 rounded-[1.75rem]" />
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
    <div className="safe-bottom flex flex-col gap-5 px-4 pb-6 pt-5">
      <header className="flex items-center justify-between gap-4">
        <LogoFull />
        <BrandBadge className="hidden min-[380px]:inline-flex">Session log</BrandBadge>
      </header>

      <section className="voltflow-card p-5">
        <p className="text-muted-foreground text-xs uppercase tracking-[0.28em]">
          {t("history.eyebrow")}
        </p>
        <h1 className="mt-2 font-heading text-3xl font-bold tracking-normal">{t("history.title")}</h1>
        <p className="text-muted-foreground mt-2 max-w-xl text-sm leading-6">
          {t("history.subtitle")}
        </p>
      </section>

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
    <Card className="voltflow-card border-border bg-transparent">
      <CardContent className="flex flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-6">
          <div>
            <p className="text-muted-foreground text-xs uppercase tracking-[0.32em]">
              {started
                ? format(started, "EEEE · HH:mm · MMM d", {
                    locale: dateLocale,
                  })
                : t("history.queued")}
            </p>
            <p className="mt-4 font-heading text-4xl font-bold tracking-tight tabular-nums">
              {pct}
              %
            </p>
          </div>
          <span
            className={`rounded-full border border-border bg-white/[0.04] px-4 py-2 font-heading text-xs font-semibold uppercase tracking-[0.2em] ${statusTone}`}
          >
            {statusLabel}
          </span>
        </div>
        <dl className="divide-y divide-border rounded-2xl border border-border bg-white/[0.02] px-4 text-lg">
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

        <ChargingDeltaBySoc session={session} />

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Button asChild size="lg" className="h-12 rounded-full font-heading font-semibold">
            <Link href={`/charging/${session.id}`}>{t("history.detail")}</Link>
          </Button>
          <Button
            asChild
            variant="outline"
            size="lg"
            className="h-12 rounded-full border-border bg-white/[0.03] font-heading font-semibold"
          >
            <Link href="/dashboard">{t("history.startAnother")}</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

type DeltaBySocPoint = {
  soc: number;
  delta: number;
  time: number;
};

function validNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sampleSoc(sample: ChargingSessionTelemetrySample) {
  return validNumber(sample.telemetry.soc) ?? validNumber(sample.diplus?.soc);
}

function sampleDelta(sample: ChargingSessionTelemetrySample) {
  const stored =
    validNumber(sample.diplus_cell_delta_v) ??
    validNumber(sample.telemetry.diplus_cell_delta_v) ??
    validNumber(sample.telemetry.cell_delta_v) ??
    validNumber(sample.diplus?.cell_delta_v);
  if (stored != null) return stored;

  const min =
    validNumber(sample.diplus_min_cell_voltage_v) ??
    validNumber(sample.telemetry.diplus_min_cell_voltage_v) ??
    validNumber(sample.telemetry.cell_voltage_min_v) ??
    validNumber(sample.diplus?.min_cell_voltage_v);
  const max =
    validNumber(sample.diplus_max_cell_voltage_v) ??
    validNumber(sample.telemetry.diplus_max_cell_voltage_v) ??
    validNumber(sample.telemetry.cell_voltage_max_v) ??
    validNumber(sample.diplus?.max_cell_voltage_v);

  return min != null && max != null ? max - min : null;
}

function prepareChargeDeltaPoints(samples: ChargingSessionTelemetrySample[]) {
  return samples
    .flatMap((sample) => {
      const soc = sampleSoc(sample);
      const delta = sampleDelta(sample);
      const time = Date.parse(sample.device_time);
      return soc != null && delta != null && Number.isFinite(time)
        ? [{ soc, delta, time }]
        : [];
    })
    .sort((a, b) => a.time - b.time);
}

function ChargingDeltaBySoc({ session }: { session: ChargingSessionRow }) {
  const { data = [], isLoading, error } = useBydmateChargingSessionSamplesQuery(session.id, "way");
  const points = useMemo(() => prepareChargeDeltaPoints(data), [data]);

  if (isLoading) {
    return <Skeleton className="h-48 rounded-2xl" />;
  }

  if (error || points.length === 0) {
    return null;
  }

  return <ChargeDeltaPlot points={points} />;
}

function ChargeDeltaPlot({ points }: { points: DeltaBySocPoint[] }) {
  const clipId = useId();
  const latest = points.at(-1) ?? null;
  const minSoc = Math.min(...points.map((point) => point.soc));
  const maxSoc = Math.max(...points.map((point) => point.soc));
  const minDelta = Math.min(...points.map((point) => point.delta));
  const maxDelta = Math.max(...points.map((point) => point.delta));
  const minTime = Math.min(...points.map((point) => point.time));
  const maxTime = Math.max(...points.map((point) => point.time));
  const deltaPad = Math.max((maxDelta - minDelta) * 0.14, 0.005);
  const yMin = Math.max(0, minDelta - deltaPad);
  const yMax = maxDelta + deltaPad;

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
  const path = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${x(point.time).toFixed(2)} ${y(point.delta).toFixed(2)}`)
    .join(" ");
  const socPath = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${x(point.time).toFixed(2)} ${socY(point.soc).toFixed(2)}`)
    .join(" ");
  const markers = points.length <= 80 ? points : [];

  return (
    <article className="rounded-2xl border border-border bg-white/[0.02] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-heading text-lg font-semibold tracking-tight">Delta by SOC</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            way · charge path 0-100% SOC
          </p>
        </div>
        <span className="rounded-full border border-border bg-white/[0.03] px-3 py-1 text-xs uppercase tracking-[0.16em] text-muted-foreground">
          {points.length} pts
        </span>
      </div>

      <svg className="mt-4 h-40 w-full overflow-hidden" viewBox="0 0 320 142" role="img" aria-label="Charging cell delta by SOC">
        <defs>
          <clipPath id={clipId}>
            <rect x="24" y="18" width="272" height="92" />
          </clipPath>
        </defs>
        <line x1="24" x2="296" y1="110" y2="110" stroke="currentColor" className="text-border" strokeWidth="1" />
        <line x1="24" x2="24" y1="18" y2="110" stroke="currentColor" className="text-border" strokeWidth="1" />
        <line x1="24" x2="296" y1="64" y2="64" stroke="currentColor" className="text-border/70" strokeWidth="1" strokeDasharray="4 6" />
        <text x="24" y="132" className="fill-muted-foreground text-[10px]">{formatPlotTime(minTime)}</text>
        <text x="296" y="132" textAnchor="end" className="fill-muted-foreground text-[10px]">{formatPlotTime(maxTime)}</text>
        <text x="30" y="14" className="fill-muted-foreground text-[10px]">{maxDelta.toFixed(3)} V</text>
        <text x="30" y="106" className="fill-muted-foreground text-[10px]">{minDelta.toFixed(3)} V</text>
        <text x="296" y="14" textAnchor="end" className="fill-primary text-[10px]">{maxSoc.toFixed(0)}% SOC</text>
        <text x="296" y="106" textAnchor="end" className="fill-primary text-[10px]">{minSoc.toFixed(0)}% SOC</text>
        <g clipPath={`url(#${clipId})`}>
          {points.length > 1 ? (
            <path d={socPath} fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.78" strokeDasharray="3 5" />
          ) : null}
          {points.length > 1 ? (
            <path d={path} fill="none" stroke="#38bdf8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.78" />
          ) : null}
          {markers.map((point, index) => (
            <circle
              key={`${point.time}-${index}`}
              cx={x(point.time)}
              cy={y(point.delta)}
              r={point === latest ? 4 : 3}
              fill={point === latest ? "#facc15" : "#fb7185"}
              opacity={point === latest ? 1 : 0.78}
            />
          ))}
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

      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <DeltaStat label="SOC" value={`${minSoc.toFixed(0)}-${maxSoc.toFixed(0)}%`} />
        <DeltaStat label="Delta" value={`${minDelta.toFixed(3)}-${maxDelta.toFixed(3)} V`} />
        <DeltaStat label="Latest" value={latest ? `${latest.soc.toFixed(0)}% / ${latest.delta.toFixed(3)} V` : "—"} />
      </div>
    </article>
  );
}

function formatPlotTime(ms: number) {
  if (!Number.isFinite(ms)) return "—";
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function DeltaStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-background/30 p-3">
      <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-xs text-foreground">{value}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-4">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="font-heading text-base font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function EmptyState() {
  const { t } = useTranslation();

  return (
    <div className="safe-bottom flex flex-1 flex-col gap-5 px-4 pb-6 pt-5">
      <header className="flex items-center justify-between gap-4">
        <LogoFull />
        <BrandBadge className="hidden min-[380px]:inline-flex">Session log</BrandBadge>
      </header>
      <section className="voltflow-card flex flex-1 flex-col items-center justify-center gap-6 p-6 text-center">
        <p className="text-muted-foreground text-xs uppercase tracking-[0.28em]">
          {t("history.emptyEyebrow")}
        </p>
        <h1 className="text-balance font-heading text-3xl font-bold tracking-normal">
          {t("history.emptyTitle")}
        </h1>
        <p className="text-muted-foreground mx-auto max-w-md text-sm leading-6">
          {t("history.emptyBody")}
        </p>
        <Button
          asChild
          size="lg"
          className="h-12 rounded-full bg-[linear-gradient(90deg,#00E676_0%,#00D1FF_100%)] px-8 font-heading font-semibold text-[#06110B]"
        >
          <Link href="/dashboard">{t("history.headCockpit")}</Link>
        </Button>
      </section>
    </div>
  );
}
