"use client";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { useCarPromiseEnabled } from "@/hooks/use-car-promise-enabled";
import { useTranslation } from "@/hooks/use-translation";
import { formatTimeAgo } from "@/lib/time-ago";
import type { TranslationKey } from "@/lib/i18n";
import type {
  MetricExplanation,
  ExplainRow,
} from "@/lib/voltflowmate/metric-explain";

function formatRow(row: ExplainRow, unavailable: string) {
  if (row.value == null || !Number.isFinite(row.value)) return unavailable;
  if (row.displayValue) return row.displayValue;
  if (row.unit === "date") return new Date(row.value).toLocaleString();
  return `${row.value.toFixed(row.digits ?? 1)}${row.unit ? ` ${row.unit}` : ""}`;
}

function formattedResult(explanation: MetricExplanation, unavailable: string) {
  const resultRow = explanation.rows.find((item) => item.kind === "result");
  const value = resultRow?.value;
  if (value == null || !Number.isFinite(value)) return unavailable;
  if (resultRow?.displayValue) return resultRow.displayValue;
  switch (explanation.metricKey) {
    case "aiRange":
    case "mathRange":
      return `≈ ${value.toFixed(0)} km`;
    case "kmPerPercent":
      return `${value.toFixed(1)} km/%`;
    case "sinceCharge":
      return `${value.toFixed(1)} km`;
    case "recentEnergy":
      return `~${value.toFixed(1)} kWh`;
    case "parkChargeTime":
    case "activeChargeTime":
      return `${value.toFixed(0)} s`;
    case "parkChargeEnergy":
    case "activeChargeEnergy":
      return `${value.toFixed(2)} kWh`;
    case "parkChargeCost":
    case "activeChargeCost":
      return value.toFixed(2);
    case "tripTractionEnergy":
      return `${value.toFixed(2)} kWh`;
    case "tripEnergyPerKm":
      return `${value.toFixed(2)} kWh/km`;
    case "tripNetConsumption":
      return `${value.toFixed(1)} kWh/100 km`;
    case "tripCost":
      return value.toFixed(2);
  }
}

/**
 * Display-only trust-corrected car promise (phase 4c). `null` hides the whole block — there
 * is never a switch for a correction that cannot be shown.
 */
export type CarPromiseExplain = {
  rawKm: number;
  correctedKm: number;
  factor: number;
  cycles: number;
};

function CarPromiseBlock({ carPromise }: { carPromise: CarPromiseExplain }) {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useCarPromiseEnabled();
  return (
    <div className="mt-3 rounded-xl border border-border bg-white/[0.03] p-3">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {t("vehicle.explain.carPromise.title")}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("vehicle.explain.carPromise.hint")}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={String(t("vehicle.explain.carPromise.title"))}
          onClick={() => setEnabled(!enabled)}
          className={`relative h-6 w-11 shrink-0 rounded-full border border-border transition-colors motion-reduce:transition-none ${
            enabled ? "bg-[var(--voltflow-cyan)]/70" : "bg-white/10"
          }`}
        >
          <span
            aria-hidden
            className={`absolute top-0.5 size-5 rounded-full bg-white transition-all motion-reduce:transition-none ${
              enabled ? "left-[1.375rem]" : "left-0.5"
            }`}
          />
        </button>
      </div>
      {enabled ? (
        <div className="mt-2 divide-y divide-border">
          <div className="flex items-start justify-between gap-4 py-2">
            <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {t("vehicle.explain.carPromise.raw")}
            </span>
            <span className="font-heading text-base font-semibold tabular-nums">
              {Math.round(carPromise.rawKm)} km
            </span>
          </div>
          <div className="flex items-start justify-between gap-4 py-2">
            <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {t("vehicle.explain.carPromise.factor", {
                factor: carPromise.factor.toFixed(2),
                count: carPromise.cycles,
              })}
            </span>
            <span className="font-heading text-base font-semibold tabular-nums text-[var(--voltflow-cyan)]">
              {Math.round(carPromise.correctedKm)} km
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function MetricExplainerSheet({
  open,
  onOpenChange,
  explanation,
  nowMs,
  carPromise,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  explanation: MetricExplanation | null;
  nowMs: number;
  carPromise?: CarPromiseExplain | null;
}) {
  const { t } = useTranslation();
  const [carPromiseEnabled] = useCarPromiseEnabled();
  const tx = t as (
    key: TranslationKey,
    values?: Record<string, string | number>,
  ) => string;
  if (!explanation) return null;
  // Phase 4c: with the switch ON the headline is the trust-corrected car promise; OFF keeps
  // the AI model value. The model rows below are never altered.
  const showCorrected =
    carPromise != null &&
    explanation.metricKey === "aiRange" &&
    carPromiseEnabled;
  const unavailable = t("vehicle.explain.unavailable") as string;
  const age = explanation.sourceAt
    ? formatTimeAgo(explanation.sourceAt, nowMs, tx)
    : null;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="voltflow-card safe-bottom max-h-[78dvh] overflow-y-auto rounded-b-none rounded-t-[0.875rem] px-4 pb-5 pt-3 motion-reduce:transition-none"
      >
        <div className="mx-auto h-1 w-10 rounded-full bg-border" aria-hidden />
        <div className="flex items-start justify-between gap-6">
          <div>
            <SheetTitle className="text-lg">
              {showCorrected
                ? t("vehicle.explain.carPromise.title")
                : t(explanation.titleKey)}
            </SheetTitle>
            {age ? (
              <SheetDescription>
                {t("vehicle.explain.updatedAgo", { value: age })}
              </SheetDescription>
            ) : null}
          </div>
          <strong className="shrink-0 font-heading text-lg tabular-nums text-[var(--voltflow-cyan)]">
            {showCorrected && carPromise
              ? `≈ ${Math.round(carPromise.correctedKm)} km`
              : formattedResult(explanation, unavailable)}
          </strong>
        </div>
        {carPromise && explanation.metricKey === "aiRange" ? (
          <CarPromiseBlock carPromise={carPromise} />
        ) : null}
        <div className="mt-3 rounded-xl border border-border bg-white/[0.03] p-3 font-sans text-xs tabular-nums text-muted-foreground">
          <span className="mr-2 font-heading font-semibold">
            {t("vehicle.explain.formula")}:
          </span>
          {t(explanation.formulaKey)}
        </div>
        <div className="divide-y divide-border">
          {explanation.rows.map((item, index) => (
            <div
              key={`${item.labelKey}-${index}`}
              className={`${item.kind === "result" ? "mt-1 border-t border-border font-semibold" : ""} ${item.kind === "derived" ? "pl-3" : ""} flex items-start justify-between gap-4 py-2.5`}
            >
              <div className="min-w-0 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {item.kind === "derived" ? <span aria-hidden>→ </span> : null}
                {t(item.labelKey)}
                {item.noteKey ? (
                  <p className="mt-0.5 text-[10px] font-normal normal-case tracking-normal opacity-70">
                    {t(item.noteKey)}
                  </p>
                ) : null}
              </div>
              <span className="shrink-0 font-heading text-base font-semibold tabular-nums">
                {formatRow(item, unavailable)}
              </span>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
