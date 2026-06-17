"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { formatDuration } from "@/lib/charging-math";
import type { HistoryDaySummary, HistorySummaryScope } from "@/lib/history-day-summary";
import { formatCurrencyAmount, type Currency, type Locale, type TranslationKey } from "@/lib/i18n";
import { useTranslation } from "@/hooks/use-translation";
import { useAppPreferences } from "@/stores/use-app-preferences";
import { cn } from "@/lib/utils";

type Translator = (key: TranslationKey, values?: Record<string, string | number>) => string;

const TITLE_KEYS: Record<HistorySummaryScope, TranslationKey> = {
  day: "history.daySummary.title",
  week: "history.periodSummary.titleWeek",
  month: "history.periodSummary.titleMonth",
  quarter: "history.periodSummary.titleQuarter",
  year: "history.periodSummary.titleYear",
};

function fmt(value: number, digits = 1) {
  return value.toFixed(digits);
}

function CompactStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 px-2 py-2 text-center">
      <p className="truncate text-[9px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 truncate font-heading text-sm font-semibold tabular-nums leading-none text-foreground">
        {value}
      </p>
    </div>
  );
}

function EnergyCell({ label, valueKwh }: { label: string; valueKwh: string }) {
  return (
    <div className="min-w-0 px-2.5 py-2 text-center">
      <p className="text-[9px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 font-heading text-base font-semibold tabular-nums leading-none">
        {valueKwh}
        <span className="ml-0.5 text-[11px] font-medium text-muted-foreground">kWh</span>
      </p>
    </div>
  );
}

function verdictTone(verdict: HistoryDaySummary["verdict"]) {
  if (verdict === "surplus") {
    return {
      panel: "border-teal-400/35 bg-teal-400/[0.08]",
      delta: "text-teal-300",
      explain: "text-teal-200/80",
    };
  }
  if (verdict === "deficit") {
    return {
      panel: "border-amber-400/35 bg-amber-400/[0.08]",
      delta: "text-amber-300",
      explain: "text-amber-200/80",
    };
  }
  return {
    panel: "border-border bg-white/[0.02]",
    delta: "text-foreground",
    explain: "text-muted-foreground",
  };
}

function deltaSign(verdict: HistoryDaySummary["verdict"], deltaAbs: number) {
  if (verdict === "surplus") return `+${fmt(deltaAbs, 1)}`;
  if (verdict === "deficit") return `−${fmt(deltaAbs, 1)}`;
  return `≈${fmt(deltaAbs, 1)}`;
}

export function HistoryDaySummaryCard({
  summary,
  loading,
  locale,
  currency,
  scope = "day",
  requireCharging = true,
}: {
  summary: HistoryDaySummary | null;
  loading?: boolean;
  locale: Locale;
  currency: Currency;
  scope?: HistorySummaryScope;
  /** Charging tab: only when sessions exist. Analytics: trips-only days still show. */
  requireCharging?: boolean;
}) {
  const { t } = useTranslation();
  const tx = t as Translator;
  const defaultPricePerKwh = useAppPreferences((state) => state.defaultPricePerKwh);

  if (loading) {
    return (
      <div className="overflow-hidden rounded-2xl border border-border bg-white/[0.02]" aria-busy="true">
        <Skeleton className="h-8 w-full rounded-none" />
        <div className="grid grid-cols-3 divide-x divide-border border-t border-border">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 rounded-none" />
          ))}
        </div>
        <Skeleton className="h-14 w-full rounded-none border-t border-border" />
        <Skeleton className="h-16 w-full rounded-none border-t border-border" />
      </div>
    );
  }

  if (!summary) return null;
  if (requireCharging && !summary.hasCharging) return null;
  if (!requireCharging && !summary.hasCharging && !summary.hasTrips) return null;

  const deltaAbs = Math.abs(summary.deltaKwh);
  const showBalance = summary.hasTrips && summary.driveKwh > 0 && summary.hasCharging;
  const tone = verdictTone(summary.verdict);
  const isDay = scope === "day";
  const balanceTitleKey = isDay
    ? "history.daySummary.balanceTitle"
    : "history.periodSummary.balanceTitle";
  const explainKey =
    summary.verdict === "surplus"
      ? isDay
        ? "history.daySummary.balanceExplainSurplus"
        : "history.periodSummary.balanceExplainSurplus"
      : summary.verdict === "deficit"
        ? isDay
          ? "history.daySummary.balanceExplainDeficit"
          : "history.periodSummary.balanceExplainDeficit"
        : isDay
          ? "history.daySummary.balanceExplainBalanced"
          : "history.periodSummary.balanceExplainBalanced";
  const noTripsKey = isDay ? "history.daySummary.noTrips" : "history.periodSummary.noTrips";

  const fallbackCost =
    !summary.hasPricedSessions &&
    summary.chargedKwh > 0 &&
    defaultPricePerKwh > 0
      ? summary.chargedKwh * defaultPricePerKwh
      : null;
  const totalCost = summary.hasPricedSessions
    ? summary.chargingCost
    : fallbackCost;
  const costValue = totalCost != null
    ? formatCurrencyAmount(currency, totalCost, locale)
    : "—";
  const durationValue =
    summary.chargingDurationSec > 0 ? formatDuration(summary.chargingDurationSec) : "—";
  const distanceValue = summary.hasTrips ? `${fmt(summary.distanceKm, 0)} km` : "—";
  const chargedStr = fmt(summary.chargedKwh, 1);
  const driveStr = summary.hasTrips ? fmt(summary.driveKwh, 1) : "—";

  return (
    <section
      className="overflow-hidden rounded-2xl border border-border bg-white/[0.02] shadow-[inset_0_1px_0_rgb(255_255_255/0.04)]"
      aria-label={tx(TITLE_KEYS[scope])}
    >
      <header className="border-b border-border px-2.5 py-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          {tx(TITLE_KEYS[scope])}
        </p>
      </header>

      <div className="grid grid-cols-3 divide-x divide-border border-b border-border">
        <CompactStat label={tx("history.daySummary.cost")} value={costValue} />
        <CompactStat label={tx("history.daySummary.duration")} value={durationValue} />
        <CompactStat label={tx("history.daySummary.distance")} value={distanceValue} />
      </div>

      <div className="grid grid-cols-2 divide-x divide-border border-b border-border">
        <EnergyCell label={tx("history.daySummary.charged")} valueKwh={chargedStr} />
        <EnergyCell label={tx("history.daySummary.drive")} valueKwh={driveStr} />
      </div>

      {!summary.hasTrips ? (
        <p className="border-b border-border px-2.5 py-2 text-center text-[11px] text-muted-foreground">
          {tx(noTripsKey)}
        </p>
      ) : showBalance ? (
        <div className={cn("border-b border-border px-2.5 py-2.5 text-center", tone.panel)}>
          <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {tx(balanceTitleKey)}
          </p>
          <p className={cn("mt-1.5 font-heading text-xl font-bold tabular-nums leading-none", tone.delta)}>
            {deltaSign(summary.verdict, deltaAbs)}
            <span className="ml-1 text-sm font-semibold text-muted-foreground">kWh</span>
          </p>
          <p className={cn("mt-1 text-[11px] leading-snug", tone.explain)}>
            {tx(explainKey)}
            {summary.regenKwh > 0.05 ? (
              <span className="text-muted-foreground">
                {" "}
                · {tx("history.daySummary.regenNote", { value: fmt(summary.regenKwh, 1) })}
              </span>
            ) : null}
          </p>
        </div>
      ) : null}

      <p className="px-2.5 py-1.5 text-[10px] leading-snug text-muted-foreground">
        {tx("history.daySummary.acFootnote")}
      </p>
    </section>
  );
}
