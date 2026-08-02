"use client";

import { BatteryCharging, Route } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { formatDuration } from "@/features/charging/domain";
import type { Locale, TranslationKey } from "@/lib/i18n";
import type { BydmateTripRow, ChargingSessionRow } from "@/types/database";

type Translate = (key: TranslationKey, values?: Record<string, string | number>) => string;

function localeCode(locale: Locale) {
  return locale === "be" ? "be-BY" : locale === "ru" ? "ru-RU" : "en-US";
}

function fmt(value: number | null | undefined, digits = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "—";
}

function formatClockRange(startIso: string | null, endIso: string | null, locale: Locale) {
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

function SummaryCard({
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
        <span className="block text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </span>
        <span className="block font-heading text-lg font-bold tracking-normal text-foreground">
          {title}
        </span>
        <span className="mt-1 block text-sm leading-5 text-muted-foreground">{body}</span>
        {meta ? (
          <span className="mt-1 block truncate text-xs font-medium text-muted-foreground">{meta}</span>
        ) : null}
      </span>
      <span className="text-[var(--voltflow-cyan)]">{icon}</span>
    </Link>
  );
}

export function DashboardDeferredSummaries({
  appPath,
  latestSession,
  latestTrip,
  loadingTrips,
  locale,
  t,
}: {
  appPath: (path: string) => string;
  latestSession: ChargingSessionRow | null;
  latestTrip: BydmateTripRow | null;
  loadingTrips: boolean;
  locale: Locale;
  t: Translate;
}) {
  return (
    <section className="dashboard-summary-grid grid grid-cols-2 gap-2">
      <SummaryCard
        href={latestTrip ? appPath(`/vehicle?trip=${encodeURIComponent(latestTrip.id)}`) : appPath("/vehicle")}
        icon={<Route className="size-5" aria-hidden />}
        label={t("dashboard.latestTrip")}
        title={loadingTrips ? t("dashboard.loading") : latestTrip ? `${fmt(latestTrip.distance_km, 1)} km` : t("dashboard.noTrip")}
        body={
          latestTrip
            ? formatClockRange(latestTrip.started_at, latestTrip.ended_at ?? latestTrip.last_device_time, locale)
            : t("dashboard.openVehicle")
        }
        meta={
          latestTrip
            ? `${tripSoc(latestTrip)} · ${fmt(latestTrip.avg_consumption_kwh_100km, 1)} kWh/100`
            : undefined
        }
      />
      <SummaryCard
        href={latestSession ? appPath(`/history/${latestSession.id}`) : appPath("/charging")}
        icon={<BatteryCharging className="size-5" aria-hidden />}
        label={t("dashboard.latestCharge")}
        title={
          latestSession
            ? `${fmt(latestSession.start_percent)}% -> ${fmt(latestSession.current_percent)}%`
            : t("dashboard.noCharge")
        }
        body={
          latestSession
            ? formatClockRange(
                latestSession.started_at ?? latestSession.created_at,
                latestSession.stopped_at ?? latestSession.updated_at,
                locale,
              )
            : t("dashboard.startFirstCharge")
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
    </section>
  );
}
