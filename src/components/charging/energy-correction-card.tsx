"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { correctChargingSessionEnergy } from "@/actions/session-corrections";
import { currencyTextWithIcon } from "@/components/currency-amount";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { currencySymbols } from "@/lib/i18n";
import { queryKeys } from "@/lib/query-keys";
import { useTranslation } from "@/hooks/use-translation";
import { useAppPreferences } from "@/stores/use-app-preferences";
import type { ChargingSessionRow } from "@/types/database";

/**
 * Smart Charge "Loose Mode": lets the user replace a finished session's estimated
 * kWh/cost with what the provider actually billed. Feeds charging-efficiency-learning.ts
 * via correctChargingSessionEnergy — see docs/CHARGING_SESSIONS.md.
 */
export function EnergyCorrectionCard({
  session,
  sessionId,
}: {
  session: ChargingSessionRow;
  sessionId: string;
}) {
  const qc = useQueryClient();
  const { t } = useTranslation();
  const currency = useAppPreferences((s) => s.currency);
  const currencySymbol = currencySymbols[currency];
  const [kwhDraft, setKwhDraft] = useState(
    session.charged_energy_kwh > 0 ? String(session.charged_energy_kwh) : "",
  );
  const [costDraft, setCostDraft] = useState(
    session.estimated_cost > 0 ? String(session.estimated_cost) : "",
  );
  const [saving, setSaving] = useState(false);
  const [lastMeasuredEfficiency, setLastMeasuredEfficiency] = useState<number | null>(null);

  if (session.status !== "completed" && session.status !== "stopped") return null;

  const billedKwh = Number.parseFloat(kwhDraft.replace(",", "."));
  const totalCost = Number.parseFloat(costDraft.replace(",", "."));
  const derivedPricePerKwh =
    Number.isFinite(billedKwh) && billedKwh > 0 && Number.isFinite(totalCost)
      ? totalCost / billedKwh
      : null;

  const handleSave = async () => {
    if (!Number.isFinite(billedKwh) || billedKwh <= 0 || !Number.isFinite(totalCost) || totalCost < 0) {
      toast.error(t("charging.correction.invalidInput") as string);
      return;
    }
    setSaving(true);
    const res = await correctChargingSessionEnergy({ sessionId, billedKwh, totalCost });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setLastMeasuredEfficiency(res.measuredEfficiencyPercent);
    await qc.invalidateQueries({ queryKey: queryKeys.session(sessionId) });
    await qc.invalidateQueries({ queryKey: queryKeys.sessions });
    if (res.warning === "implausible_efficiency") {
      toast.warning(t("charging.correction.savedImplausible") as string);
    } else {
      toast.success(t("charging.correction.saved") as string);
    }
  };

  return (
    <section className="voltflow-card space-y-3 p-4">
      <p className="text-sm font-semibold tracking-tight">
        {t("charging.correction.title") as string}
      </p>
      <p className="text-muted-foreground text-xs">
        {t("charging.correction.hint") as string}
      </p>
      {session.energy_corrected_at ? (
        <p className="rounded-xl border border-[var(--voltflow-green)]/30 bg-[var(--voltflow-green)]/10 px-3 py-2 text-xs text-[var(--voltflow-green)]">
          {t("charging.correction.alreadyCorrected") as string}
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="correction-kwh">{t("charging.correction.billedKwh") as string}</Label>
          <Input
            id="correction-kwh"
            inputMode="decimal"
            value={kwhDraft}
            onChange={(event) => setKwhDraft(event.target.value)}
            className="h-11 rounded-2xl text-sm"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="correction-cost">
            {currencyTextWithIcon(
              t("charging.correction.totalPaid", { currency: currencySymbol }) as string,
              currency,
            )}
          </Label>
          <Input
            id="correction-cost"
            inputMode="decimal"
            value={costDraft}
            onChange={(event) => setCostDraft(event.target.value)}
            className="h-11 rounded-2xl text-sm"
          />
        </div>
      </div>
      {derivedPricePerKwh != null ? (
        <p className="text-muted-foreground text-xs tabular-nums">
          {currencyTextWithIcon(
            t("charging.correction.derivedPrice", {
              currency: currencySymbol,
              price: derivedPricePerKwh.toFixed(3),
            }) as string,
            currency,
          )}
        </p>
      ) : null}
      {lastMeasuredEfficiency != null ? (
        <p className="text-xs tabular-nums text-[var(--voltflow-cyan)]">
          {t("charging.correction.measuredEfficiency", {
            percent: lastMeasuredEfficiency.toFixed(1),
            configured: session.efficiency_percent.toFixed(1),
          })}
        </p>
      ) : null}
      <Button
        type="button"
        variant="secondary"
        className="h-11 w-full rounded-full text-sm font-semibold"
        disabled={saving}
        onClick={() => void handleSave()}
      >
        {saving ? (t("common.saving") as string) : (t("charging.correction.save") as string)}
      </Button>
    </section>
  );
}
