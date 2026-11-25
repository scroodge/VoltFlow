"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useId, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { currencyTextWithIcon } from "@/components/currency-amount";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslation } from "@/hooks/use-translation";
import { useUserProviderMap, useUserProvidersQuery } from "@/hooks/use-user-providers-query";
import { resolveProviderTariff } from "@/lib/charging-tariffs";
import { currencySymbols, type TranslationKey } from "@/lib/i18n";
import { parseDecimalInput } from "@/lib/number-input";
import { queryKeys } from "@/lib/query-keys";
import { useAppPreferences } from "@/stores/use-app-preferences";
import type { ChargingProviderType, ChargingSessionRow, ChargingTariffType } from "@/types/database";
import { updateChargingSessionTariff } from "../actions";

const TARIFF_TYPES = ["home", "commercial_ac", "fast_dc"] as const;

function providerValue(type: ChargingProviderType, id?: string | null) {
  return type === "user_provider" && id ? `up_${id}` : type;
}

export function ChargingSessionTariffForm({
  session,
  onCancel,
  onSaved,
  onSavingChange,
  previewSave,
}: {
  session: ChargingSessionRow;
  onCancel?: () => void;
  onSaved?: () => void;
  onSavingChange?: (saving: boolean) => void;
  previewSave?: typeof updateChargingSessionTariff;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const formId = useId();
  const currency = useAppPreferences((s) => s.currency);
  const defaultPrice = useAppPreferences((s) => s.defaultPricePerKwh);
  const { data: userProviders } = useUserProvidersQuery();
  const userProviderMap = useUserProviderMap();
  const savedProvider = providerValue(session.provider_type, session.user_provider_id);
  const [provider, setProvider] = useState(savedProvider);
  const [tariffType, setTariffType] = useState(session.tariff_type);
  const [priceDraft, setPriceDraft] = useState(() =>
    session.tariff_manual || session.price_per_kwh > 0
      ? String(session.price_per_kwh)
      : previewSave ? "" : String(defaultPrice),
  );
  const [saving, setSaving] = useState(false);

  const providers = useMemo(() => {
    const options = [
      { value: "custom", label: t("charging.tariff.providers.custom") },
      ...(userProviders ?? []).map((row) => ({ value: `up_${row.id}`, label: row.label })),
    ];
    if (!options.some((option) => option.value === savedProvider)) {
      options.push({
        value: savedProvider,
        label: t(`charging.tariff.providers.${session.provider_type}` as TranslationKey),
      });
    }
    return options;
  }, [savedProvider, session.provider_type, t, userProviders]);

  const tariffs = useMemo(() => TARIFF_TYPES.map((value) => ({
    value,
    label: t(`charging.tariff.types.${value}` as TranslationKey),
  })), [t]);

  function applyPreset(nextProvider: string, nextTariff: ChargingTariffType) {
    if (nextProvider === "custom") return;
    if (nextProvider.startsWith("up_")) {
      const id = nextProvider.slice(3);
      if (!userProviders?.some((row) => row.id === id)) return;
      setPriceDraft(String(resolveProviderTariff("user_provider", id, userProviderMap)[nextTariff]));
    } else if (nextProvider !== "user_provider") {
      setPriceDraft(String(resolveProviderTariff(nextProvider as Exclude<ChargingProviderType, "custom">)[nextTariff]));
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const pricePerKwh = parseDecimalInput(priceDraft);
    if (!priceDraft.trim() || !Number.isFinite(pricePerKwh) || pricePerKwh < 0 || pricePerKwh > 999) {
      toast.error(t("charging.tariff.invalidPrice") as string);
      return;
    }

    const userProviderId = provider.startsWith("up_") ? provider.slice(3) : undefined;
    setSaving(true);
    onSavingChange?.(true);
    try {
      const result = await (previewSave ?? updateChargingSessionTariff)({
        sessionId: session.id,
        tariffType,
        providerType: userProviderId ? "user_provider" : provider as ChargingProviderType,
        userProviderId,
        pricePerKwh,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (!previewSave) {
        await Promise.all([
          qc.invalidateQueries({ queryKey: queryKeys.session(session.id) }),
          qc.invalidateQueries({ queryKey: queryKeys.sessions }),
        ]);
      }
      toast.success(t("charging.tariff.updated") as string);
      onSaved?.();
    } catch {
      toast.error(t("charging.tariff.saveError") as string);
    } finally {
      setSaving(false);
      onSavingChange?.(false);
    }
  }

  return (
    <form className="space-y-3" onSubmit={save}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${formId}-provider`}>{t("charging.tariff.provider")}</Label>
          <Select
            value={provider}
            onValueChange={(value) => {
              if (!value) return;
              setProvider(value);
              applyPreset(value, tariffType);
            }}
            disabled={saving}
            modal={false}
            items={providers}
          >
            <SelectTrigger id={`${formId}-provider`} className="h-11 w-full rounded-2xl text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="z-[200]">
              {providers.map(({ value, label }) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${formId}-type`}>{t("charging.tariff.type")}</Label>
          <Select
            value={tariffType}
            onValueChange={(value) => {
              if (!value) return;
              setTariffType(value);
              applyPreset(provider, value);
            }}
            disabled={saving}
            modal={false}
            items={tariffs}
          >
            <SelectTrigger id={`${formId}-type`} className="h-11 w-full rounded-2xl text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="z-[200]">
              {tariffs.map(({ value, label }) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${formId}-price`}>
            {currencyTextWithIcon(
              t("charging.tariff.pricePerKwh", { currency: currencySymbols[currency] }) as string,
              currency,
            )}
          </Label>
          <Input
            id={`${formId}-price`}
            inputMode="decimal"
            value={priceDraft}
            onChange={(event) => setPriceDraft(event.target.value)}
            disabled={saving}
            className="h-11 rounded-2xl text-sm"
          />
        </div>
      </div>
      <div className="flex gap-2">
        {onCancel ? (
          <Button type="button" variant="outline" className="h-11 rounded-full" disabled={saving} onClick={onCancel}>
            {t("common.cancel")}
          </Button>
        ) : null}
        <Button type="submit" variant={onCancel ? "default" : "secondary"} className="h-11 flex-1 rounded-full text-sm font-semibold" disabled={saving}>
          {saving ? t("common.saving") : t("charging.tariff.save")}
        </Button>
      </div>
    </form>
  );
}
