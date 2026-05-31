"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";

import { BrandBadge } from "@/components/brand/BrandBadge";
import { LogoFull } from "@/components/brand/LogoFull";
import { VehicleAnalyticsPanels } from "@/components/vehicle/vehicle-analytics-panels";
import { TripDetailPanel } from "@/components/vehicle/TripDetailPanel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDuration } from "@/lib/charging-math";
import { useAppPath } from "@/lib/dev/dev-path";
import { useBydmateLiveQuery } from "@/hooks/use-bydmate-live-query";
import { useSessionsQuery } from "@/hooks/use-sessions-query";
import { useLatestBydmateTripsQuery } from "@/hooks/use-bydmate-trips-query";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/lib/i18n";
import type { BydmateTripRow, ChargingSessionRow } from "@/types/database";

type HistoryTranslator = (key: TranslationKey, values?: Record<string, string | number>) => string;

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

function formatShortDate(isoStr: string | null | undefined) {
  if (!isoStr) return "—";
  return new Date(isoStr).toLocaleDateString(undefined, {
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

// ─── Tab selector ─────────────────────────────────────────────────────────────

type HistoryTab = "charging" | "trips" | "analytics";

function parseHistoryTab(value: string | null): HistoryTab {
  if (value === "trips" || value === "analytics") return value;
  return "charging";
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

function StatusBadge({ status }: { status: string }) {
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
      className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] ${tone}`}
    >
      {status}
    </span>
  );
}

// ─── Mini Calendar ─────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAY_LABELS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

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
  const today = localTodayKey();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const offset = (new Date(year, month, 1).getDay() + 6) % 7;

  return (
    <div className="voltflow-card p-3">
      <div className="mb-3 flex items-center justify-between">
        <span className="font-heading text-base font-bold">
          {MONTH_NAMES[month]} {year}
        </span>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={onPrev}
            aria-label="Previous month"
            className="flex size-7 items-center justify-center rounded-full border border-border bg-white/[0.03] text-sm text-muted-foreground transition hover:border-primary/50 hover:text-foreground"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={onNext}
            aria-label="Next month"
            className="flex size-7 items-center justify-center rounded-full border border-border bg-white/[0.03] text-sm text-muted-foreground transition hover:border-primary/50 hover:text-foreground"
          >
            ›
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {DAY_LABELS.map((d) => (
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
          Clear · show all
        </button>
      )}
    </div>
  );
}

// ─── Shared stat components ───────────────────────────────────────────────────

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="font-heading text-sm font-semibold tabular-nums">{value}</dd>
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
  const started = session.started_at;
  return (
    <div className="voltflow-card p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">
            {started
              ? `${formatShortDate(started)} · ${formatClock(started)}`
              : "Queued"}
          </p>
          <p className="mt-1.5 font-heading text-3xl font-bold tabular-nums">
            {fmt(session.current_percent, 1)}
            <span className="text-lg text-muted-foreground">%</span>
          </p>
        </div>
        <StatusBadge status={session.status} />
      </div>

      <dl className="mt-3 divide-y divide-border rounded-xl border border-border bg-white/[0.02] px-3">
        <StatRow
          label="Start → Target"
          value={`${fmt(session.start_percent)}% → ${fmt(session.target_percent)}%`}
        />
        <StatRow label="Energy" value={`${fmt(session.charged_energy_kwh, 2)} kWh`} />
        {session.price_per_kwh > 0 && (
          <StatRow label="Cost" value={fmt(session.estimated_cost, 2)} />
        )}
        <StatRow label="Duration" value={sessionDuration(session)} />
      </dl>

      <Button
        asChild
        size="sm"
        className="mt-3 h-9 w-full rounded-full font-heading font-semibold"
      >
        <Link href={appPath(`/history/${session.id}`)}>View Detail</Link>
      </Button>
    </div>
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
            {formatShortDate(started)} · {formatClock(started)}
          </p>
        </div>
        <StatusBadge status={session.status} />
        <span className="font-heading text-sm font-bold tabular-nums">
          {fmt(session.current_percent, 1)}%
        </span>
        <span className="hidden text-xs text-muted-foreground sm:inline">
          {sessionDuration(session)}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-border px-3 pb-3 pt-2.5">
          <dl className="divide-y divide-border rounded-xl border border-border bg-white/[0.02] px-3">
            <StatRow
              label="Start → Target"
              value={`${fmt(session.start_percent)}% → ${fmt(session.target_percent)}%`}
            />
            <StatRow label="Energy" value={`${fmt(session.charged_energy_kwh, 2)} kWh`} />
            {session.price_per_kwh > 0 && (
              <StatRow label="Cost" value={fmt(session.estimated_cost, 2)} />
            )}
            <StatRow label="Duration" value={sessionDuration(session)} />
          </dl>
          <Button
            asChild
            variant="outline"
            size="sm"
            className="mt-2.5 h-8 w-full rounded-full border-border font-heading text-xs font-semibold"
          >
            <Link href={appPath(`/history/${session.id}`)}>View Detail →</Link>
          </Button>
        </div>
      )}
    </div>
  );
}

function ChargingTab({ sessions }: { sessions: ChargingSessionRow[] }) {
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

      {filteredSessions.length === 0 ? (
        <p className="rounded-2xl border border-border bg-white/[0.02] p-4 text-center text-sm text-muted-foreground">
          {sessions.length === 0
            ? "No charging sessions yet."
            : "No sessions on this date. Pick a highlighted day on the calendar."}
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

function TripCard({ trip, label }: { trip: BydmateTripRow; label: string }) {
  const [showDetail, setShowDetail] = useState(false);

  return (
    <div className="flex flex-col gap-2.5">
      <div className="voltflow-card p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
              {label}
            </p>
            <p className="mt-1 font-heading text-xl font-bold">
              {formatClock(trip.started_at)}
              <span className="text-muted-foreground"> – </span>
              {formatClock(trip.ended_at ?? trip.last_device_time)}
              <span className="ml-1.5 text-sm font-normal text-muted-foreground">
                {tripDuration(trip)}
              </span>
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="font-heading text-2xl font-bold tabular-nums text-emerald-300">
              {fmt(trip.distance_km, 1)}
              <span className="text-sm font-normal text-muted-foreground"> km</span>
            </p>
            <p className="text-xs text-muted-foreground">
              {fmt(trip.soc_start)}% → {fmt(trip.soc_end)}%
            </p>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 min-[360px]:grid-cols-3">
          <MiniStat label="Max speed" value={`${fmt(trip.max_speed_kmh)} km/h`} />
          <MiniStat label="Avg speed" value={`${fmt(trip.avg_speed_kmh, 1)} km/h`} />
          <MiniStat
            label="Consumption"
            value={`${fmt(trip.avg_consumption_kwh_100km, 1)} kWh/100`}
          />
          <MiniStat label="Regen" value={`${fmt(trip.regen_energy_kwh, 2)} kWh`} />
          <MiniStat label="Samples" value={String(trip.sample_count)} />
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowDetail((v) => !v)}
          className="mt-3 h-8 w-full rounded-full border-border font-heading text-xs font-semibold"
        >
          {showDetail ? "Hide Detail" : "View Detail"}
        </Button>
      </div>

      {showDetail && <TripDetailPanel tripId={trip.id} />}
    </div>
  );
}

function TripAccordionItem({
  trip,
  label,
  expanded,
  onToggle,
}: {
  trip: BydmateTripRow;
  label: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const [showDetail, setShowDetail] = useState(false);

  return (
    <div className="flex flex-col gap-2.5">
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
            <p className="font-heading text-sm font-semibold">{label}</p>
            <p className="truncate text-xs text-muted-foreground">
              {formatClock(trip.started_at)} –{" "}
              {formatClock(trip.ended_at ?? trip.last_device_time)} · {tripDuration(trip)}
            </p>
          </div>
          <span className="shrink-0 text-xs text-emerald-300 tabular-nums">
            {fmt(trip.regen_energy_kwh, 2)} kWh↩
          </span>
          <span className="shrink-0 font-heading text-sm font-semibold tabular-nums">
            {fmt(trip.distance_km, 1)} km
          </span>
        </button>

        {expanded && (
          <div className="border-t border-border px-3 pb-3 pt-2.5">
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 min-[360px]:grid-cols-3">
              <MiniStat
                label="SOC"
                value={`${fmt(trip.soc_start)}→${fmt(trip.soc_end)}%`}
              />
              <MiniStat label="Max speed" value={`${fmt(trip.max_speed_kmh)} km/h`} />
              <MiniStat
                label="Avg speed"
                value={`${fmt(trip.avg_speed_kmh, 1)} km/h`}
              />
              <MiniStat
                label="Consumption"
                value={`${fmt(trip.avg_consumption_kwh_100km, 1)} kWh/100`}
              />
              <MiniStat
                label="Regen"
                value={`${fmt(trip.regen_energy_kwh, 2)} kWh`}
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowDetail((v) => !v)}
              className="mt-2.5 h-8 w-full rounded-full border-border font-heading text-xs font-semibold"
            >
              {showDetail ? "Hide Detail" : "View Detail"}
            </Button>
          </div>
        )}
      </div>

      {expanded && showDetail && <TripDetailPanel tripId={trip.id} />}
    </div>
  );
}

function TripsTab({ allTrips }: { allTrips: BydmateTripRow[] }) {
  const now = new Date();
  const [calYear, setCalYear] = useState(now.getFullYear());
  const [calMonth, setCalMonth] = useState(now.getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(() =>
    pickInitialTripDate(allTrips),
  );
  const [selectedTripId, setSelectedTripId] = useState<string | null | undefined>(undefined);

  const tripDates = useMemo(() => {
    const set = new Set<string>();
    for (const t of allTrips) set.add(localDateKey(t.started_at));
    return set;
  }, [allTrips]);

  useEffect(() => {
    if (allTrips.length === 0) return;
    const hasOnSelected = allTrips.some(
      (t) => !selectedDate || localDateKey(t.started_at) === selectedDate,
    );
    if (hasOnSelected) return;
    setSelectedDate(pickInitialTripDate(allTrips));
  }, [allTrips, selectedDate]);

  const filteredTrips = useMemo(() => {
    if (!selectedDate) return allTrips.slice(0, 10);
    return allTrips.filter((t) => localDateKey(t.started_at) === selectedDate);
  }, [allTrips, selectedDate]);

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

  const [latestTrip, ...olderTrips] = filteredTrips;

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
          Showing {filteredTrips.length} latest · Select a day to filter
        </p>
      )}

      {filteredTrips.length === 0 ? (
        <p className="rounded-2xl border border-border bg-white/[0.02] p-4 text-center text-sm text-muted-foreground">
          No trips on this date.
        </p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {latestTrip && (
            <TripCard trip={latestTrip} label={`Trip ${filteredTrips.length}`} />
          )}
          {olderTrips.map((trip, index) => {
            const label = `Trip ${filteredTrips.length - 1 - index}`;
            const isExpanded = expandedTripId === trip.id;
            return (
              <TripAccordionItem
                key={trip.id}
                trip={trip}
                label={label}
                expanded={isExpanded}
                onToggle={() =>
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
  return (
    <div className="safe-bottom flex flex-col gap-3 px-4 pb-6 pt-4">
      <header className="flex items-center justify-between gap-4">
        <LogoFull />
        <BrandBadge className="hidden min-[380px]:inline-flex">History</BrandBadge>
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
  const { data: sessions = [], isLoading: sessionsLoading } = useSessionsQuery();
  const { data: trips = [], isLoading: tripsLoading } = useLatestBydmateTripsQuery(null, 100);
  const { data: liveRows = [], isLoading: liveLoading } = useBydmateLiveQuery();

  const vehicleId = useMemo(() => {
    const fromLive = liveRows[0]?.vehicle_id;
    if (fromLive) return fromLive;
    return trips[0]?.vehicle_id ?? null;
  }, [liveRows, trips]);

  useEffect(() => {
    setTab(parseHistoryTab(searchParams.get("tab")));
  }, [searchParams]);

  const handleTabChange = (nextTab: HistoryTab) => {
    setTab(nextTab);
    router.replace(appPath(`/history?tab=${nextTab}`), { scroll: false });
  };

  if (sessionsLoading && tripsLoading && tab !== "analytics") {
    return <LoadingSkeleton />;
  }

  return (
    <div className="safe-bottom flex flex-col gap-3 px-4 pb-6 pt-4">
      <header className="flex items-center justify-between gap-4">
        <LogoFull />
        <BrandBadge className="hidden min-[380px]:inline-flex">History</BrandBadge>
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
            Connect VoltFlow Mate to unlock analytics.
          </p>
        ) : (
          <VehicleAnalyticsPanels vehicleId={vehicleId} />
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
            No charging sessions yet.
          </p>
        ) : (
          <ChargingTab sessions={sessions} />
        )
      ) : tripsLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-52 rounded-2xl" />
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 rounded-2xl" />
          ))}
        </div>
      ) : (
        <TripsTab allTrips={trips} />
      )}
    </div>
  );
}
