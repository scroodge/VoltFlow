"use client";

import { CheckCircle2, Loader2 } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { currencyTextWithIcon } from "@/components/currency-amount";
import { ProviderTariffsSection } from "@/components/settings/provider-tariffs-section";
import { TariffLocationsSection } from "@/components/settings/tariff-locations-section";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { useProfileQuery } from "@/hooks/use-profile-query";
import { useTranslation } from "@/hooks/use-translation";
import { useUpdateProfile } from "@/hooks/use-update-profile";
import {
  currencies,
  currencyLabels,
  currencySymbols,
  isCurrency,
  type Currency,
} from "@/lib/i18n";
import { parseDecimalInput } from "@/lib/number-input";
import { useAppPreferences } from "@/stores/use-app-preferences";

export function EconomicsSettings() {
  const { t } = useTranslation();
  const { data: profile } = useProfileQuery();
  const updateProfile = useUpdateProfile();

  const currency = useAppPreferences((s) => s.currency);
  const setCurrency = useAppPreferences((s) => s.setCurrency);
  const homePricePerKwh = useAppPreferences((s) => s.homePricePerKwh);
  const commercialAcPricePerKwh = useAppPreferences(
    (s) => s.commercialAcPricePerKwh,
  );
  const fastDcPricePerKwh = useAppPreferences((s) => s.fastDcPricePerKwh);
  const setDefaultPrice = useAppPreferences((s) => s.setDefaultPricePerKwh);
  const setTariffPrices = useAppPreferences((s) => s.setTariffPrices);

  const [tariffSaveState, setTariffSaveState] = useState<
    "idle" | "saving" | "saved"
  >("idle");
  const tariffSavedResetRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  useEffect(() => {
    return () => {
      if (tariffSavedResetRef.current)
        clearTimeout(tariffSavedResetRef.current);
    };
  }, []);

  const markTariffSaved = () => {
    setTariffSaveState("saved");
    if (tariffSavedResetRef.current) clearTimeout(tariffSavedResetRef.current);
    tariffSavedResetRef.current = setTimeout(
      () => setTariffSaveState("idle"),
      2_000,
    );
  };

  const handleCurrencyChange = async (value: Currency | null) => {
    if (!value || !isCurrency(value)) return;
    const previous = currency;
    setCurrency(value);

    const result = await updateProfile({ preferred_currency: value });
    if (!result.ok) {
      setCurrency(previous);
      toast.error(result.error);
      return;
    }
    toast.success(t("settings.currencySaved") as string);
  };

  const handlePriceSave = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (tariffSaveState === "saving") return;
    const form = new FormData(event.currentTarget);
    const homeNumeric = parseDecimalInput(
      String(form.get("pref-price-home") ?? ""),
    );
    const acNumeric = parseDecimalInput(
      String(form.get("pref-price-ac") ?? ""),
    );
    const dcNumeric = parseDecimalInput(
      String(form.get("pref-price-dc") ?? ""),
    );
    if (
      !Number.isFinite(homeNumeric) ||
      !Number.isFinite(acNumeric) ||
      !Number.isFinite(dcNumeric) ||
      homeNumeric < 0 ||
      acNumeric < 0 ||
      dcNumeric < 0
    ) {
      toast.error(t("settings.tariffPositive") as string);
      return;
    }

    const previous = {
      home: homePricePerKwh,
      ac: commercialAcPricePerKwh,
      dc: fastDcPricePerKwh,
    };
    setTariffPrices({
      homePricePerKwh: homeNumeric,
      commercialAcPricePerKwh: acNumeric,
      fastDcPricePerKwh: dcNumeric,
    });
    setDefaultPrice(homeNumeric);

    if (!profile) {
      toast.success(t("settings.tariffSaved") as string);
      markTariffSaved();
      return;
    }

    setTariffSaveState("saving");
    const save = (async () => {
      const result = await updateProfile({
        default_price_per_kwh: homeNumeric,
        home_price_per_kwh: homeNumeric,
        commercial_ac_price_per_kwh: acNumeric,
        fast_dc_price_per_kwh: dcNumeric,
      });
      if (!result.ok) throw new Error(result.error);
    })();

    toast.promise(save, {
      loading: t("settings.tariffSaving") as string,
      success: t("settings.tariffSaved") as string,
      error: (err: unknown) =>
        err instanceof Error ? err.message : String(err),
    });

    void save
      .then(() => {
        markTariffSaved();
      })
      .catch(() => {
        setTariffPrices({
          homePricePerKwh: previous.home,
          commercialAcPricePerKwh: previous.ac,
          fastDcPricePerKwh: previous.dc,
        });
        setDefaultPrice(previous.home);
        setTariffSaveState("idle");
      });
  };

  const tariffLabel = (
    key:
      | "settings.locationTariffs.homeTariff"
      | "settings.locationTariffs.acTariff"
      | "settings.locationTariffs.dcTariff",
  ) =>
    currencyTextWithIcon(
      t(key, { currency: currencySymbols[currency] }) as string,
      currency,
    );

  return (
    <Card size="sm" className="border-white/[0.08]">
      <CardHeader>
        <CardTitle>{t("settings.economics")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <form className="space-y-4" onSubmit={handlePriceSave}>
          <div className="space-y-4">
            <Label htmlFor="pref-currency">{t("settings.currency")}</Label>
            <Select
              value={currency}
              onValueChange={(value) => void handleCurrencyChange(value)}
              items={currencies.map((item) => ({
                value: item,
                label: currencyLabels[item],
              }))}
            >
              <SelectTrigger
                id="pref-currency"
                className="h-11 w-full rounded-2xl text-sm"
              >
                <SelectValue>
                  {(value: Currency | null) =>
                    value
                      ? currencyTextWithIcon(currencyLabels[value], value)
                      : null
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {currencies.map((item) => (
                  <SelectItem key={item} value={item}>
                    {currencyTextWithIcon(currencyLabels[item], item)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-sm">
              {t("settings.currencyHelp")}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="pref-price-home">
              {tariffLabel("settings.locationTariffs.homeTariff")}
            </Label>
            <Input
              key={homePricePerKwh}
              id="pref-price-home"
              name="pref-price-home"
              type="text"
              step="any"
              defaultValue={String(homePricePerKwh)}
              inputMode="decimal"
              pattern="[0-9]*[,.]?[0-9]*"
              min={0}
              className="h-11 rounded-2xl text-sm"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pref-price-ac">
              {tariffLabel("settings.locationTariffs.acTariff")}
            </Label>
            <Input
              key={commercialAcPricePerKwh}
              id="pref-price-ac"
              name="pref-price-ac"
              type="text"
              step="any"
              defaultValue={String(commercialAcPricePerKwh)}
              inputMode="decimal"
              pattern="[0-9]*[,.]?[0-9]*"
              min={0}
              className="h-11 rounded-2xl text-sm"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pref-price-dc">
              {tariffLabel("settings.locationTariffs.dcTariff")}
            </Label>
            <Input
              key={fastDcPricePerKwh}
              id="pref-price-dc"
              name="pref-price-dc"
              type="text"
              step="any"
              defaultValue={String(fastDcPricePerKwh)}
              inputMode="decimal"
              pattern="[0-9]*[,.]?[0-9]*"
              min={0}
              className="h-11 rounded-2xl text-sm"
              required
            />
          </div>
          <p className="text-muted-foreground text-sm">
            {t("settings.locationTariffs.autoTierHint") as string}
          </p>
          <Button
            className="h-11 w-full rounded-full text-sm font-semibold"
            type="submit"
            disabled={tariffSaveState === "saving"}
          >
            {tariffSaveState === "saving" ? (
              <>
                <Loader2 className="animate-spin" />
                {t("settings.tariffSaving")}
              </>
            ) : tariffSaveState === "saved" ? (
              <>
                <CheckCircle2 />
                {t("settings.tariffSavedShort")}
              </>
            ) : (
              t("settings.storeDefault")
            )}
          </Button>
        </form>

        <ProviderTariffsSection />
        <TariffLocationsSection />
      </CardContent>
    </Card>
  );
}
