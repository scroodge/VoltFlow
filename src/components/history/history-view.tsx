"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";

import { BrandBadge } from "@/components/brand/BrandBadge";
import { LogoFull } from "@/components/brand/LogoFull";
import { CurrencyAmount } from "@/components/currency-amount";
import {
  localCalendarDate,
  parseAnalyticsRange,
  type TelemetryHistoryRange,
} from "@/lib/bydmate/telemetry-ranges";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDuration } from "@/lib/charging-math";
import { useAppPath } from "@/lib/dev/dev-path";
import { useBydmateLiveQuery } from "@/hooks/use-bydmate-live-query";
import { useSessionsQuery } from "@/hooks/use-sessions-query";
import { useLatestBydmateTripsQuery, useBydmateTripsQuery, useTripMonthDatesQuery } from "@/hooks/use-bydmate-trips-query";
import { useTranslation } from "@/hooks/use-translation";
import { HistoryDaySummaryCard } from "@/components/history/history-day-summary-card";
import { computeHistoryDaySummary } from "@/lib/history-day-summary";
import { type Currency, type Locale, type TranslationKey } from "@/lib/i18n";
import { useAppPreferences } from "@/stores/use-app-preferences";
import type { BydmateTripRow, ChargingSessionRow } from "@/types/database";

const VehicleAnalyticsPanels = dynamic(() =>
  import("@/components/vehicle/vehicle-analytics-panels").then(
    (module) => module.VehicleAnalyticsPanels,
  ),
);

const TripDetailPanel = dynamic(() =>
  import("@/components/vehicle/TripDetailPanel").then((module) => module.TripDetailPanel),
);

type HistoryTranslator = (key: TranslationKey, values?: Record<string, string | number>) => string;

function localeCode(locale: Locale) {
  return locale === "be" ? "be-BY" : locale === "ru" ? "ru-RU" : "en-US";
}

function calendarMonthLabel(year: number, month: number, locale: Locale) {
  return new Date(year, month, 1).toLocaleDateString(localeCode(locale), {
    month: "long",
    year: "numeric",
  });
}

function calendarWeekdayLabels(locale: Locale) {
  const formatter = new Intl.DateTimeFormat(localeCode(locale), { weekday: "short" });
  const monday = new Date(2024, 0, 1);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    return formatter.format(date);
  });
}

function sessionStatusLabel(t: HistoryTranslator, status: string) {
  if (status === "completed") return t("history.status.completed");
  if (status === "stopped") return t("history.status.stopped");
  if (status === "charging") return t("history.status.charging");
  return status;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(v: number | null | undefined, d = 0) {
  return typeof v === "number" && Number.isFinite(v) ? v.toFixed(d) : "—";
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function localDateKey(isoStr: string) {
  const d = new Date(isoStr);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function formatClock(isoStr: string | null | undefined) {
  if (!isoStr) return "—";
  const d = new Date(isoStr);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function formatShortDate(
  isoStr: string | null | undefined,
  locale: Locale,
) {
  if (!isoStr) return "—";
  return new Date(isoStr).toLocaleDateString(localeCode(locale), {
    day: "numeric",
    month: "short",
  });
}

function sessionDuration(session: ChargingSessionRow) {
  const started = session.started_at ? new Date(session.started_at) : null;
  const ended = session.stopped_at ? new Date(session.stopped_at) : null;
  if (!started || !ended) return "—";
  return formatDuration((ended.getTime() - started.getTime()) / 1000);
}

function tripDuration(trip: BydmateTripRow) {
  const startMs = Date.parse(trip.started_at);
  const endMs = Date.parse(trip.ended_at ?? trip.last_device_time);
  return formatDuration((endMs - startMs) / 1000);
}

function tripTractionKwh(trip: BydmateTripRow) {
  const traction = trip.traction_energy_kwh;
  if (typeof traction === "number" && Number.isFinite(traction)) return traction;

  const distance = trip.distance_km;
  const consumption = trip.avg_consumption_kwh_100km;
  if (
    typeof distance === "number" &&
    Number.isFinite(distance) &&
    distance > 0 &&
    typeof consumption === "number" &&
    Number.isFinite(consumption)
  ) {
    return (distance * consumption) / 100;
  }

  return null;
}

function formatTripTractionKwh(trip: BydmateTripRow, digits = 2) {
  const kwh = tripTractionKwh(trip);
  return kwh != null ? `${fmt(kwh, digits)} kWh` : "—";
}

// ─── Tab selector ─────────────────────────────────────────────────────────────

type HistoryTab = "charging" | "trips" | "analytics";

function parseHistoryTab(value: string | null): HistoryTab {
  if (value === "charging" || value === "trips" || value === "analytics") return value;
  return "trips";
}

function TabToggle({
  active,
  onChange,
}: {
  active: HistoryTab;
  onChange: (tab: HistoryTab) => void;
}) {
  const { t } = useTranslation();
  const tx = t as HistoryTranslator;

  const tabs: { id: HistoryTab; label: string }[] = [
    { id: "charging", label: tx("history.tab.charging") },
    { id: "trips", label: tx("history.tab.trips") },
    { id: "analytics", label: tx("history.tab.analytics") },
  ];

  return (
    <div className="flex rounded-full border border-border bg-white/[0.03] p-1">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={[
            "flex-1 rounded-full py-1.5 font-heading text-sm font-semibold transition",
            active === tab.id
              ? "bg-primary text-[#06110B]"
              : "text-muted-foreground hover:text-foreground",
          ].join(" ")}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status, compact }: { status: string; compact?: boolean }) {
  const { t } = useTranslation();
  const tx = t as HistoryTranslator;
  const tone =
    status === "completed"
      ? "border-teal-400/30 bg-teal-400/10 text-teal-200"
      : status === "stopped"
        ? "border-yellow-400/30 bg-yellow-400/10 text-yellow-200"
        : status === "charging"
          ? "border-primary/30 bg-primary/10 text-primary"
          : "border-border bg-white/[0.03] text-muted-foreground";
  return (
    <span
      className={[
        "shrink-0 rounded-full border font-semibold uppercase",
        compact
          ? "px-2 py-0.5 text-[9px] tracking-[0.14em]"
          : "px-2.5 py-0.5 text-[10px] tracking-[0.18em]",
        tone,
      ].join(" ")}
    >
      {sessionStatusLabel(tx, status)}
    </span>
  );
}

// ─── Mini Calendar ─────────────────────────────────────────────────────────────

function toCalKey(year: number, month: number, day: number) {
  return `${year}-${pad2(month + 1)}-${pad2(day)}`;
}

function localTodayKey() {
  const now = new Date();
  return toCalKey(now.getFullYear(), now.getMonth(), now.getDate());
}

function pickInitialChargingDate(sessions: ChargingSessionRow[]) {
  const today = localTodayKey();
  if (sessions.some((s) => s.started_at && localDateKey(s.started_at) === today)) {
    return today;
  }
  const latest = sessions.find((s) => s.started_at)?.started_at;
  return latest ? localDateKey(latest) : today;
}

function pickInitialTripDate(trips: BydmateTripRow[]) {
  const today = localTodayKey();
  if (trips.some((t) => localDateKey(t.started_at) === today)) {
    return today;
  }
  const latest = trips[0]?.started_at;
  return latest ? localDateKey(latest) : today;
}

function MiniCalendar({
  year,
  month,
  highlightedDates,
  selectedDate,
  onPrev,
  onNext,
  onSelect,
}: {
  year: number;
  month: number;
  highlightedDates: Set<string>;
  selectedDate: string | null;
  onPrev: () => void;
  onNext: () => void;
  onSelect: (date: string | null) => void;
}) {
  const { locale, t } = useTranslation();
  const tx = t as HistoryTranslator;
  const today = localTodayKey();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const offset = (new Date(year, month, 1).getDay() + 6) % 7;
  const dayLabels = useMemo(() => calendarWeekdayLabels(locale), [locale]);

  return (
    <div className="voltflow-card p-3">
      <div className="mb-3 flex items-center justify-between">
        <span className="font-heading text-base font-bold">
          {calendarMonthLabel(year, month, locale)}
        </span>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={onPrev}
            aria-label={tx("history.calendar.prevMonth")}
            className="flex size-7 items-center justify-center rounded-full border border-border bg-white/[0.03] text-sm text-muted-foreground transition hover:border-primary/50 hover:text-foreground"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={onNext}
            aria-label={tx("history.calendar.nextMonth")}
            className="flex size-7 items-center justify-center rounded-full border border-border bg-white/[0.03] text-sm text-muted-foreground transition hover:border-primary/50 hover:text-foreground"
          >
            ›
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {dayLabels.map((d) => (
          <div
            key={d}
            className="py-0.5 text-center text-[10px] uppercase tracking-wider text-muted-foreground"
          >
            {d}
          </div>
        ))}
        {Array.from({ length: offset }).map((_, i) => (
          <div key={`pad-${i}`} />
        ))}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          const key = toCalKey(year, month, day);
          const hasData = highlightedDates.has(key);
          const isSelected = selectedDate === key;
          const isToday = key === today;

          return (
            <button
              key={day}
              type="button"
              onClick={() => onSelect(isSelected ? null : key)}
              className={[
                "relative flex flex-col items-center justify-center rounded-lg py-1 text-sm transition",
                isSelected
                  ? "bg-primary font-semibold text-[#06110B]"
                  : isToday
                    ? "border border-primary/50 text-primary"
                    : "text-foreground hover:bg-white/[0.04]",
              ].join(" ")}
            >
              {day}
              {hasData && (
                <span
                  className={`absolute bottom-0.5 left-1/2 size-1 -translate-x-1/2 rounded-full ${isSelected ? "bg-[#06110B]" : "bg-primary"}`}
                />
              )}
            </button>
          );
        })}
      </div>

      {selectedDate && (
        <button
          type="button"
          onClick={() => onSelect(null)}
          className="mt-2 w-full text-center text-xs text-muted-foreground transition hover:text-foreground"
        >
          {tx("history.calendar.clear")}
        </button>
      )}
    </div>
  );
}

// ─── Shared stat components ───────────────────────────────────────────────────

function CompactStatRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 px-2.5 py-1.5">
      <dt className="min-w-0 truncate text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </dt>
      <dd className="shrink-0 font-heading text-xs font-semibold tabular-nums text-foreground">
        {value}
      </dd>
    </div>
  );
}

function SessionStatsBlock({
  session,
  tx,
  currency,
  locale,
}: {
  session: ChargingSessionRow;
  tx: HistoryTranslator;
  currency: Currency;
  locale: Locale;
}) {
  const tariffLabel =
    session.tariff_type === "commercial_ac"
      ? "Commercial AC"
      : session.tariff_type === "fast_dc"
        ? "Fast DC"
        : "Home";
  const providerLabel =
    session.provider_type === "malanka"
      ? "Malanka"
      : session.provider_type === "evika"
        ? "Evika!"
        : session.provider_type === "forevo"
          ? "forEVo"
          : session.provider_type === "zaryadka"
            ? "Zaryadka"
            : session.provider_type === "batterfly"
              ? "BatteryFly"
              : session.provider_type === "home"
                ? "Home"
                : "Custom";
  return (
    <dl className="divide-y divide-border border-b border-border">
      <CompactStatRow
        label={tx("history.charging.startEnd")}
        value={`${fmt(session.start_percent)}% → ${fmt(session.current_percent)}%`}
      />
      {session.current_percent + 0.5 < session.target_percent ? (
        <CompactStatRow
          label={tx("history.charging.target")}
          value={`${fmt(session.target_percent)}%`}
        />
      ) : null}
      <CompactStatRow
        label={tx("history.energy")}
        value={`${fmt(session.charged_energy_kwh, 2)} kWh`}
      />
      {session.price_per_kwh > 0 ? (
        <CompactStatRow
          label={tx("history.cost")}
          value={<CurrencyAmount currency={currency} value={session.estimated_cost} locale={locale} />}
        />
      ) : null}
      <CompactStatRow label="Tariff" value={tariffLabel} />
      <CompactStatRow label="Provider" value={providerLabel} />
      <CompactStatRow label={tx("history.duration")} value={sessionDuration(session)} />
    </dl>
  );
}

function SessionCardHeader({
  session,
  locale,
  tx,
}: {
  session: ChargingSessionRow;
  locale: Locale;
  tx: HistoryTranslator;
}) {
  const started = session.started_at;
  return (
    <div className="flex items-center justify-between gap-2 border-b border-border px-2.5 py-2">
      <div className="min-w-0">
        <p className="truncate text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          {started
            ? `${formatShortDate(started, locale)} · ${formatClock(started)}`
            : tx("history.queued")}
        </p>
        <p className="mt-0.5 font-heading text-2xl font-bold leading-none tabular-nums">
          {fmt(session.current_percent, 1)}
          <span className="text-base font-semibold text-muted-foreground">%</span>
        </p>
      </div>
      <StatusBadge status={session.status} compact />
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 font-heading text-sm font-semibold tabular-nums">
        {value}
      </p>
    </div>
  );
}

// ─── Charging tab ─────────────────────────────────────────────────────────────

function SessionCard({ session }: { session: ChargingSessionRow }) {
  const appPath = useAppPath();
  const { locale, t } = useTranslation();
  const currency = useAppPreferences((s) => s.currency);
  const tx = t as HistoryTranslator;
  return (
    <article className="overflow-hidden rounded-2xl border border-border bg-white/[0.02] shadow-[inset_0_1px_0_rgb(255_255_255/0.04)]">
      <SessionCardHeader session={session} locale={locale} tx={tx} />
      <SessionStatsBlock session={session} tx={tx} currency={currency} locale={locale} />
      <div className="p-2">
        <Button
          asChild
          size="sm"
          className="h-8 w-full rounded-full font-heading text-xs font-semibold"
        >
          <Link href={appPath(`/history/${session.id}`)}>{tx("history.charging.viewDetail")}</Link>
        </Button>
      </div>
    </article>
  );
}

function SessionAccordionItem({
  session,
  expanded,
  onToggle,
}: {
  session: ChargingSessionRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const appPath = useAppPath();
  const { locale, t } = useTranslation();
  const currency = useAppPreferences((s) => s.currency);
  const tx = t as HistoryTranslator;
  const started = session.started_at;
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-white/[0.02]">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition hover:bg-white/[0.03]"
      >
        {expanded ? (
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-muted-foreground">
            {formatShortDate(started, locale)} · {formatClock(started)}
          </p>
        </div>
        <StatusBadge status={session.status} compact />
        <span className="font-heading text-sm font-bold tabular-nums">
          {fmt(session.current_percent, 1)}%
        </span>
        <span className="hidden max-w-[4.5rem] truncate text-[10px] text-muted-foreground min-[360px]:inline">
          {sessionDuration(session)}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-border">
          <SessionStatsBlock session={session} tx={tx} currency={currency} locale={locale} />
          <div className="p-2">
            <Button
              asChild
              variant="outline"
              size="sm"
              className="h-8 w-full rounded-full border-border font-heading text-xs font-semibold"
            >
              <Link href={appPath(`/history/${session.id}`)}>
                {tx("history.charging.viewDetail")}
              </Link>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ChargingTab({
  sessions,
  vehicleId,
}: {
  sessions: ChargingSessionRow[];
  vehicleId: string | null;
}) {
  const { locale, t } = useTranslation();
  const currency = useAppPreferences((s) => s.currency);
  const tx = t as HistoryTranslator;
  const now = new Date();
  const [calYear, setCalYear] = useState(now.getFullYear());
  const [calMonth, setCalMonth] = useState(now.getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(() =>
    pickInitialChargingDate(sessions),
  );
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const sessionDates = useMemo(() => {
    const set = new Set<string>();
    for (const s of sessions) {
      if (s.started_at) set.add(localDateKey(s.started_at));
    }
    return set;
  }, [sessions]);

  useEffect(() => {
    if (sessions.length === 0) return;
    const hasOnSelected = sessions.some(
      (s) => s.started_at && (!selectedDate || localDateKey(s.started_at) === selectedDate),
    );
    if (hasOnSelected) return;
    setSelectedDate(pickInitialChargingDate(sessions));
  }, [sessions, selectedDate]);

  const filteredSessions = useMemo(() => {
    if (!selectedDate) return sessions;
    return sessions.filter(
      (s) => s.started_at && localDateKey(s.started_at) === selectedDate,
    );
  }, [sessions, selectedDate]);

  const [latestSession, ...olderSessions] = filteredSessions;

  const { data: dayTrips = [], isLoading: dayTripsLoading } = useBydmateTripsQuery(
    selectedDate ?? "",
    vehicleId,
    Boolean(selectedDate && vehicleId),
  );

  const daySummary = useMemo(() => {
    if (!selectedDate) return null;
    return computeHistoryDaySummary(sessions, dayTrips, selectedDate);
  }, [sessions, dayTrips, selectedDate]);

  const prevMonth = () => {
    if (calMonth === 0) { setCalYear((y) => y - 1); setCalMonth(11); }
    else setCalMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (calMonth === 11) { setCalYear((y) => y + 1); setCalMonth(0); }
    else setCalMonth((m) => m + 1);
  };

  return (
    <div className="flex flex-col gap-3">
      <MiniCalendar
        year={calYear}
        month={calMonth}
        highlightedDates={sessionDates}
        selectedDate={selectedDate}
        onPrev={prevMonth}
        onNext={nextMonth}
        onSelect={setSelectedDate}
      />

      {selectedDate ? (
        <HistoryDaySummaryCard
          summary={daySummary}
          loading={Boolean(vehicleId) && dayTripsLoading}
          locale={locale}
          currency={currency}
        />
      ) : null}

      {filteredSessions.length === 0 ? (
        <p className="rounded-2xl border border-border bg-white/[0.02] p-4 text-center text-sm text-muted-foreground">
          {sessions.length === 0
            ? tx("history.charging.empty")
            : tx("history.charging.emptyFiltered")}
        </p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {latestSession && <SessionCard session={latestSession} />}
          {olderSessions.map((s) => (
            <SessionAccordionItem
              key={s.id}
              session={s}
              expanded={expandedId === s.id}
              onToggle={() =>
                setExpandedId((current) => (current === s.id ? null : s.id))
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Trips tab ────────────────────────────────────────────────────────────────

function TripStatsGrid({ trip, tx }: { trip: BydmateTripRow; tx: HistoryTranslator }) {
  const hasFuel = typeof trip.fuel_kwh === "number" && trip.fuel_kwh > 0;
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 border-t border-border px-2.5 py-2.5 min-[360px]:grid-cols-3">
      <MiniStat label={tx("vehicle.trips.maxSpeed")} value={`${fmt(trip.max_speed_kmh)} km/h`} />
      <MiniStat label={tx("vehicle.trips.avgSpeed")} value={`${fmt(trip.avg_speed_kmh, 1)} km/h`} />
      <MiniStat
        label={tx("vehicle.trips.consumption")}
        value={`${fmt(trip.avg_consumption_kwh_100km, 1)} kWh/100`}
      />
      {hasFuel ? (
        <MiniStat label={tx("vehicle.trips.fuel")} value={`${fmt(trip.fuel_kwh, 2)} kWh`} />
      ) : null}
      <MiniStat label={tx("vehicle.trips.regen")} value={`${fmt(trip.regen_energy_kwh, 2)} kWh`} />
      <MiniStat label={tx("vehicle.trips.traction")} value={formatTripTractionKwh(trip)} />
      <MiniStat
        label={tx("vehicle.analytics.summary.telemetry")}
        value={String(trip.sample_count)}
      />
    </div>
  );
}

function TripCardHeader({
  trip,
  label,
  tx,
  collapsible,
  expanded,
  onToggle,
}: {
  trip: BydmateTripRow;
  label: string;
  tx: HistoryTranslator;
  collapsible?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
}) {
  return (
    <div className="flex items-center gap-2 px-2.5 py-2">
      {collapsible && onToggle ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="shrink-0 rounded-md p-0.5 text-muted-foreground transition hover:bg-white/[0.04] hover:text-foreground"
        >
          {expanded ? (
            <ChevronDown className="size-3.5" aria-hidden />
          ) : (
            <ChevronRight className="size-3.5" aria-hidden />
          )}
        </button>
      ) : null}
      <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          {label}
          {trip.source === "byd_energydata" ? (
            <span className="rounded-full border border-border px-1.5 py-0.5 text-[9px] font-semibold normal-case tracking-normal text-muted-foreground">
              {tx("history.trips.bydLogBadge")}
            </span>
          ) : null}
        </p>
        <p className="mt-0.5 font-heading text-lg font-bold leading-tight">
          {formatClock(trip.started_at)}
          <span className="text-muted-foreground"> – </span>
          {formatClock(trip.ended_at ?? trip.last_device_time)}
          <span className="ml-1.5 text-sm font-normal text-muted-foreground">
            {tripDuration(trip)}
          </span>
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="font-heading text-xl font-bold tabular-nums text-emerald-300">
          {fmt(trip.distance_km, 1)}
          <span className="text-sm font-normal text-muted-foreground"> km</span>
        </p>
        <p className="text-xs tabular-nums text-muted-foreground">
          {fmt(trip.soc_start)}% → {fmt(trip.soc_end)}%
        </p>
      </div>
      </div>
    </div>
  );
}

function HistoryTripCard({
  trip,
  label,
  featured,
  expanded,
  onToggle,
}: {
  trip: BydmateTripRow;
  label: string;
  featured?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
}) {
  const { t } = useTranslation();
  const tx = t as HistoryTranslator;
  const [showDetail, setShowDetail] = useState(false);
  const isOpen = featured || Boolean(expanded);

  return (
    <div className="flex flex-col gap-2.5">
      <article className="overflow-hidden rounded-2xl border border-border bg-white/[0.02] shadow-[inset_0_1px_0_rgb(255_255_255/0.04)]">
        {!isOpen && !featured && onToggle ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={false}
            className="flex w-full items-center gap-2.5 px-2.5 py-2 text-left transition hover:bg-white/[0.03]"
          >
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                {label}
              </p>
              <p className="truncate font-heading text-sm font-semibold">
                {formatClock(trip.started_at)} – {formatClock(trip.ended_at ?? trip.last_device_time)}
                <span className="ml-1 font-normal text-muted-foreground">{tripDuration(trip)}</span>
              </p>
            </div>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {fmt(trip.soc_start)}→{fmt(trip.soc_end)}%
            </span>
            <span className="shrink-0 font-heading text-sm font-semibold tabular-nums text-emerald-300">
              {fmt(trip.distance_km, 1)} km
            </span>
          </button>
        ) : null}

        {isOpen ? (
          <>
            <TripCardHeader
              trip={trip}
              label={label}
              tx={tx}
              collapsible={!featured}
              expanded={isOpen}
              onToggle={onToggle}
            />
            <TripStatsGrid trip={trip} tx={tx} />
            <div className="border-t border-border p-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowDetail((v) => !v)}
                className="h-8 w-full rounded-full border-border font-heading text-xs font-semibold"
              >
                {showDetail ? tx("history.trips.hideDetail") : tx("history.trips.viewDetail")}
              </Button>
            </div>
          </>
        ) : null}
      </article>

      {isOpen && showDetail ? <TripDetailPanel tripId={trip.id} /> : null}
    </div>
  );
}

function TripsTab({ vehicleId }: { vehicleId: string | null }) {
  const { t } = useTranslation();
  const tx = t as HistoryTranslator;
  const now = new Date();
  const [calYear, setCalYear] = useState(now.getFullYear());
  const [calMonth, setCalMonth] = useState(now.getMonth());
  const { data: latestTrips = [], isLoading: latestLoading } = useLatestBydmateTripsQuery(vehicleId, 100);
  const { data: monthDateList = [] } = useTripMonthDatesQuery(calYear, calMonth, vehicleId);
  const [selectedDate, setSelectedDate] = useState<string | null>(() =>
    pickInitialTripDate(latestTrips),
  );
  const [selectedTripId, setSelectedTripId] = useState<string | null | undefined>(undefined);
  const { data: dayTrips = [], isLoading: dayLoading } = useBydmateTripsQuery(
    selectedDate ?? "",
    vehicleId,
    Boolean(selectedDate),
  );

  const tripDates = useMemo(() => {
    const set = new Set(monthDateList);
    for (const trip of latestTrips) {
      set.add(localDateKey(trip.started_at));
    }
    return set;
  }, [monthDateList, latestTrips]);

  useEffect(() => {
    if (!selectedDate) return;
    if (monthDateList.includes(selectedDate)) return;
    if (latestTrips.some((t) => localDateKey(t.started_at) === selectedDate)) return;
    if (latestTrips.length === 0) return;
    setSelectedDate(pickInitialTripDate(latestTrips));
  }, [latestTrips, selectedDate, monthDateList]);

  const filteredTrips = useMemo(() => {
    if (selectedDate) return dayTrips;
    return latestTrips.slice(0, 10);
  }, [selectedDate, dayTrips, latestTrips]);

  const tripsLoading = selectedDate ? dayLoading : latestLoading;

  const defaultTripId = filteredTrips[0]?.id ?? null;
  const expandedTripId = selectedTripId === undefined ? defaultTripId : selectedTripId;

  const prevMonth = () => {
    if (calMonth === 0) { setCalYear((y) => y - 1); setCalMonth(11); }
    else setCalMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (calMonth === 11) { setCalYear((y) => y + 1); setCalMonth(0); }
    else setCalMonth((m) => m + 1);
  };

  return (
    <div className="flex flex-col gap-3">
      <MiniCalendar
        year={calYear}
        month={calMonth}
        highlightedDates={tripDates}
        selectedDate={selectedDate}
        onPrev={prevMonth}
        onNext={nextMonth}
        onSelect={(date) => {
          setSelectedDate(date);
          setSelectedTripId(undefined);
        }}
      />

      {!selectedDate && (
        <p className="text-center text-xs text-muted-foreground">
          {tx("history.trips.latestHint", { count: filteredTrips.length })}
        </p>
      )}

      {tripsLoading ? (
        <div className="flex flex-col gap-2.5">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 rounded-2xl" />
          ))}
        </div>
      ) : filteredTrips.length === 0 ? (
        <p className="rounded-2xl border border-border bg-white/[0.02] p-4 text-center text-sm text-muted-foreground">
          {tx("vehicle.analytics.dayTripsEmpty")}
        </p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {filteredTrips.map((trip, index) => {
            const label = tx("vehicle.trips.tripLabel", {
              value: filteredTrips.length - index,
            });
            const featured = index === 0;
            const isExpanded = expandedTripId === trip.id;
            return (
              <HistoryTripCard
                key={trip.id}
                trip={trip}
                label={label}
                featured={featured}
                expanded={isExpanded}
                onToggle={
                  featured
                    ? undefined
                    : () =>
                        setSelectedTripId((curr) => {
                          const currExpanded = curr === undefined ? defaultTripId : curr;
                          return currExpanded === trip.id ? null : trip.id;
                        })
                }
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function LoadingSkeleton() {
  const { t } = useTranslation();
  return (
    <div className="safe-bottom flex flex-col gap-3 px-4 pb-6 pt-4">
      <header className="flex items-center justify-between gap-4">
        <LogoFull />
        <BrandBadge className="hidden min-[380px]:inline-flex">{t("nav.history")}</BrandBadge>
      </header>
      <Skeleton className="h-10 rounded-full" />
      <Skeleton className="h-52 rounded-2xl" />
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-12 rounded-2xl" />
      ))}
    </div>
  );
}

// ─── Main export ─────────────────────────────────────────────────────────────

export function HistoryView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const appPath = useAppPath();
  const initialTab = parseHistoryTab(searchParams.get("tab"));
  const [tab, setTab] = useState<HistoryTab>(initialTab);
  const { t } = useTranslation();
  const tx = t as HistoryTranslator;
  const { data: sessions = [], isLoading: sessionsLoading } = useSessionsQuery();
  const { data: liveRows = [], isLoading: liveLoading } = useBydmateLiveQuery();
  const tripVehicleId = liveRows[0]?.vehicle_id ?? null;
  const { data: trips = [], isLoading: tripsLoading } = useLatestBydmateTripsQuery(tripVehicleId, 100);

  const vehicleId = useMemo(() => {
    if (tripVehicleId) return tripVehicleId;
    return trips[0]?.vehicle_id ?? null;
  }, [tripVehicleId, trips]);

  useEffect(() => {
    setTab(parseHistoryTab(searchParams.get("tab")));
  }, [searchParams]);

  const analyticsRange = parseAnalyticsRange(searchParams.get("range"));
  const analyticsDate =
    searchParams.get("date") ?? localCalendarDate();

  const buildHistoryUrl = (
    nextTab: HistoryTab,
    range?: TelemetryHistoryRange,
    date?: string,
  ) => {
    const params = new URLSearchParams({ tab: nextTab });
    if (nextTab === "analytics" && range) {
      params.set("range", range);
      if (date) params.set("date", date);
    }
    return appPath(`/history?${params.toString()}`);
  };

  const handleTabChange = (nextTab: HistoryTab) => {
    setTab(nextTab);
    router.replace(
      nextTab === "analytics"
        ? buildHistoryUrl(nextTab, analyticsRange, analyticsDate)
        : buildHistoryUrl(nextTab),
      { scroll: false },
    );
  };

  const handleAnalyticsStateChange = (state: {
    range: TelemetryHistoryRange;
    date: string;
  }) => {
    router.replace(buildHistoryUrl("analytics", state.range, state.date), {
      scroll: false,
    });
  };

  if (sessionsLoading && tab === "charging") {
    return <LoadingSkeleton />;
  }

  return (
    <div className="safe-bottom flex flex-col gap-3 px-4 pb-6 pt-4">
      <header className="flex items-center justify-between gap-4">
        <LogoFull />
        <BrandBadge className="hidden min-[380px]:inline-flex">{t("nav.history")}</BrandBadge>
      </header>

      <TabToggle active={tab} onChange={handleTabChange} />

      {tab === "analytics" ? (
        liveLoading && !vehicleId ? (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-52 rounded-2xl" />
            ))}
          </div>
        ) : !vehicleId ? (
          <p className="rounded-2xl border border-border bg-white/[0.02] p-6 text-center text-sm text-muted-foreground">
            {tx("history.analytics.mateRequired")}
          </p>
        ) : (
          <VehicleAnalyticsPanels
            vehicleId={vehicleId}
            initialRange={analyticsRange}
            initialDate={analyticsDate}
            onAnalyticsStateChange={handleAnalyticsStateChange}
          />
        )
      ) : tab === "charging" ? (
        sessionsLoading ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-52 rounded-2xl" />
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 rounded-2xl" />
            ))}
          </div>
        ) : sessions.length === 0 ? (
          <p className="rounded-2xl border border-border bg-white/[0.02] p-6 text-center text-sm text-muted-foreground">
            {tx("history.charging.empty")}
          </p>
        ) : (
          <ChargingTab sessions={sessions} vehicleId={vehicleId} />
        )
      ) : (
        <TripsTab vehicleId={tripVehicleId ?? trips[0]?.vehicle_id ?? null} />
      )}
    </div>
  );
}
