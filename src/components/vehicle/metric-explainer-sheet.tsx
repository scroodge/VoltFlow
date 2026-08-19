"use client";

import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useTranslation } from "@/hooks/use-translation";
import { formatTimeAgo } from "@/lib/time-ago";
import type { TranslationKey } from "@/lib/i18n";
import type { MetricExplanation, ExplainRow } from "@/lib/voltflowmate/metric-explain";

function formatRow(row: ExplainRow, unavailable: string) {
  if (row.value == null || !Number.isFinite(row.value)) return unavailable;
  if (row.unit === "date") return new Date(row.value).toLocaleString();
  return `${row.value.toFixed(row.digits ?? 1)}${row.unit ? ` ${row.unit}` : ""}`;
}

function formattedResult(explanation: MetricExplanation, unavailable: string) {
  const value = explanation.rows.find((item) => item.kind === "result")?.value;
  if (value == null || !Number.isFinite(value)) return unavailable;
  switch (explanation.metricKey) {
    case "aiRange": case "mathRange": return `≈ ${value.toFixed(0)} km`;
    case "kmPerPercent": return `${value.toFixed(1)} km/%`;
    case "sinceCharge": return `${value.toFixed(1)} km`;
    case "recentEnergy": return `~${value.toFixed(1)} kWh`;
  }
}

export function MetricExplainerSheet({ open, onOpenChange, explanation, nowMs }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  explanation: MetricExplanation | null;
  nowMs: number;
}) {
  const { t } = useTranslation();
  const tx = t as (key: TranslationKey, values?: Record<string, string | number>) => string;
  if (!explanation) return null;
  const unavailable = t("vehicle.explain.unavailable") as string;
  const age = explanation.sourceAt ? formatTimeAgo(explanation.sourceAt, nowMs, tx) : null;
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
            <SheetTitle className="text-lg">{t(explanation.titleKey)}</SheetTitle>
            {age ? <SheetDescription>{t("vehicle.explain.updatedAgo", { value: age })}</SheetDescription> : null}
          </div>
          <strong className="shrink-0 font-heading text-lg tabular-nums text-[var(--voltflow-cyan)]">
            {formattedResult(explanation, unavailable)}
          </strong>
        </div>
        <div className="rounded-xl border border-border bg-white/[0.03] p-3 font-sans text-xs tabular-nums text-muted-foreground">
          <span className="mr-2 font-heading font-semibold">{t("vehicle.explain.formula")}:</span>
          {t(explanation.formulaKey)}
        </div>
        <div className="divide-y divide-border">
          {explanation.rows.map((item, index) => (
            <div key={`${item.labelKey}-${index}`} className={`${item.kind === "result" ? "mt-1 border-t border-border font-semibold" : ""} ${item.kind === "derived" ? "pl-3" : ""} flex items-start justify-between gap-4 py-2.5`}>
              <div className="min-w-0 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {item.kind === "derived" ? <span aria-hidden>→ </span> : null}{t(item.labelKey)}
                {item.noteKey ? <p className="mt-0.5 text-[10px] font-normal normal-case tracking-normal opacity-70">{t(item.noteKey)}</p> : null}
              </div>
              <span className="shrink-0 font-heading text-base font-semibold tabular-nums">{formatRow(item, unavailable)}</span>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
