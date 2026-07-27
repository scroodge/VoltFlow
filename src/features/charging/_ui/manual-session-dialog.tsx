"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useId, useMemo, useState } from "react";
import { toast } from "sonner";

import { createManualChargingSession } from "../manual-actions";
import { deriveManualSessionFields } from "../_domain/manual-session";
import { currencyTextWithIcon } from "@/components/currency-amount";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { currencySymbols, type TranslationKey } from "@/lib/i18n";
import { queryKeys } from "@/lib/query-keys";
import { useTranslation } from "@/hooks/use-translation";
import { useAppPreferences } from "@/stores/use-app-preferences";
import type { Car } from "@/types/database";

/** `2026-07-26` + `21:40` → epoch ms in the viewer's own timezone. */
function localDateTimeToMs(dateKey: string, timeValue: string): number {
  if (!dateKey || !timeValue) return Number.NaN;
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = timeValue.split(":").map(Number);
  if ([year, month, day, hour, minute].some((n) => !Number.isFinite(n))) return Number.NaN;
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
}

function parseDecimal(value: string): number {
  return Number.parseFloat(value.replace(",", "."));
}

/**
 * Error codes from the domain and the server action are 1:1 with keys under
 * `charging.manualEntry.errors`, but TypeScript cannot narrow a template string to
 * `TranslationKey`, so assert it in one place instead of at every call site.
 */
function errorKey(code: string): TranslationKey {
  return `charging.manualEntry.errors.${code}` as TranslationKey;
}

/**
 * Small form for a charge the ingest pipeline never recorded — the user types what the
 * provider receipt says (times, billed kWh, total paid) and the server reconstructs the SOC
 * and charger-power columns the schema requires. See docs/CHARGING_SESSIONS.md.
 */
export function ManualSessionDialog({
  open,
  onOpenChange,
  car,
  dateKey,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  car: Car;
  /** `YYYY-MM-DD` of the day the user has selected in History. */
  dateKey: string;
}) {
  const id = useId();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const currency = useAppPreferences((s) => s.currency);
  const currencySymbol = currencySymbols[currency];

  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [kwhDraft, setKwhDraft] = useState("");
  const [costDraft, setCostDraft] = useState("");
  const [saving, setSaving] = useState(false);

  // Drafts start empty and are never reset in place: the caller mounts this component only
  // while open and keys it by day, so a fresh open is a fresh mount.

  const startedAtMs = localDateTimeToMs(dateKey, startTime);
  const stoppedAtMs = localDateTimeToMs(dateKey, endTime);
  const billedKwh = parseDecimal(kwhDraft);
  const totalCost = parseDecimal(costDraft);

  // Same derivation the server runs, so the preview can never disagree with what is saved.
  const derivation = useMemo(() => {
    if (!Number.isFinite(billedKwh) || !Number.isFinite(totalCost)) return null;
    return deriveManualSessionFields({
      billedKwh,
      totalCost,
      startedAtMs,
      stoppedAtMs,
      car,
    });
  }, [billedKwh, totalCost, startedAtMs, stoppedAtMs, car]);

  const preview = derivation?.ok ? derivation.derived : null;
  const canSubmit = Boolean(preview) && !saving;

  const handleSubmit = async () => {
    if (!derivation) {
      toast.error(t("charging.manualEntry.errors.invalid_energy") as string);
      return;
    }
    if (!derivation.ok) {
      toast.error(t(errorKey(derivation.reason)) as string);
      return;
    }

    setSaving(true);
    const res = await createManualChargingSession({
      carId: car.id,
      startedAt: new Date(startedAtMs).toISOString(),
      stoppedAt: new Date(stoppedAtMs).toISOString(),
      billedKwh,
      totalCost,
    });
    setSaving(false);

    if (!res.ok) {
      const key = res.code ? errorKey(res.code) : null;
      const translated = key ? (t(key) as string) : null;
      // Fall back to the server's own message when the code has no translation.
      toast.error(translated && translated !== key ? translated : res.error);
      return;
    }

    await qc.invalidateQueries({ queryKey: queryKeys.sessions });
    toast.success(
      t(
        res.socAnchored
          ? "charging.manualEntry.added"
          : "charging.manualEntry.addedUnanchored",
      ) as string,
    );
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle className="font-heading text-xl font-bold">
            {t("charging.manualEntry.title") as string}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {t("charging.manualEntry.hint") as string}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-6 py-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`${id}-start`}>
                {t("charging.manualEntry.startTime") as string}
              </Label>
              <Input
                id={`${id}-start`}
                type="time"
                value={startTime}
                onChange={(event) => setStartTime(event.target.value)}
                className="h-11 rounded-2xl text-sm"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${id}-end`}>
                {t("charging.manualEntry.endTime") as string}
              </Label>
              <Input
                id={`${id}-end`}
                type="time"
                value={endTime}
                onChange={(event) => setEndTime(event.target.value)}
                className="h-11 rounded-2xl text-sm"
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`${id}-kwh`}>
                {t("charging.manualEntry.billedKwh") as string}
              </Label>
              <Input
                id={`${id}-kwh`}
                inputMode="decimal"
                value={kwhDraft}
                onChange={(event) => setKwhDraft(event.target.value)}
                className="h-11 rounded-2xl text-sm"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${id}-cost`}>
                {currencyTextWithIcon(
                  t("charging.manualEntry.totalPaid", { currency: currencySymbol }) as string,
                  currency,
                )}
              </Label>
              <Input
                id={`${id}-cost`}
                inputMode="decimal"
                value={costDraft}
                onChange={(event) => setCostDraft(event.target.value)}
                className="h-11 rounded-2xl text-sm"
              />
            </div>
          </div>

          {preview ? (
            <p className="text-muted-foreground text-xs tabular-nums">
              {currencyTextWithIcon(
                t("charging.manualEntry.preview", {
                  currency: currencySymbol,
                  price: preview.pricePerKwh.toFixed(3),
                  power: preview.chargerPowerKw.toFixed(1),
                  soc: (preview.targetPercent - preview.startPercent).toFixed(0),
                }) as string,
                currency,
              )}
            </p>
          ) : null}
        </div>

        <DialogFooter className="gap-2 px-6 pb-6">
          <Button
            type="button"
            variant="ghost"
            className="h-11 rounded-full text-sm font-semibold"
            onClick={() => onOpenChange(false)}
          >
            {t("charging.manualEntry.cancel") as string}
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="h-11 rounded-full text-sm font-semibold"
            disabled={!canSubmit}
            onClick={() => void handleSubmit()}
          >
            {saving
              ? (t("common.saving") as string)
              : (t("charging.manualEntry.submit") as string)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
