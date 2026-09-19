"use client";

import { Loader2, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useProfileQuery } from "@/hooks/use-profile-query";
import { useTranslation } from "@/hooks/use-translation";
import { useUserProvidersQuery } from "@/hooks/use-user-providers-query";
import { parseDecimalInput } from "@/lib/number-input";
import { queryKeys } from "@/lib/query-keys";
import { createClient } from "@/lib/supabase/client";

export function ProviderTariffsSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: profile } = useProfileQuery();
  const profileUserId = profile?.id ?? null;
  const { data: userProviderRows = [] } = useUserProvidersQuery();

  const [providerPricesSaving, setProviderPricesSaving] = useState(false);
  const [newProviderLabel, setNewProviderLabel] = useState("");
  const [newProviderAc, setNewProviderAc] = useState("");
  const [newProviderDc, setNewProviderDc] = useState("");
  const [selectedProviderIds, setSelectedProviderIds] = useState<string[]>([]);
  const [newProviderSaving, setNewProviderSaving] = useState(false);

  const handleSaveProviderPrices = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!profileUserId || providerPricesSaving) return;
    const form = new FormData(event.currentTarget);
    const updates: {
      id: string;
      home_price_per_kwh: number;
      commercial_ac_price_per_kwh: number;
      fast_dc_price_per_kwh: number;
    }[] = [];

    for (const provider of userProviderRows) {
      const acInput = parseDecimalInput(
        String(form.get(`provider-${provider.id}-ac`) ?? ""),
      );
      const dcInput = parseDecimalInput(
        String(form.get(`provider-${provider.id}-dc`) ?? ""),
      );
      if (
        !Number.isFinite(acInput) ||
        !Number.isFinite(dcInput) ||
        acInput < 0 ||
        dcInput < 0
      ) {
        toast.error(t("settings.providerTariffs.invalidPrice") as string);
        return;
      }
      if (
        acInput === provider.commercial_ac_price_per_kwh &&
        dcInput === provider.fast_dc_price_per_kwh
      ) {
        continue;
      }
      updates.push({
        id: provider.id,
        home_price_per_kwh: acInput,
        commercial_ac_price_per_kwh: acInput,
        fast_dc_price_per_kwh: dcInput,
      });
    }

    if (updates.length === 0) {
      toast.success(t("settings.providerTariffs.saved") as string);
      return;
    }

    setProviderPricesSaving(true);
    const supabase = createClient();
    void Promise.all(
      updates.map((update) =>
        supabase
          .from("user_providers")
          .update({
            home_price_per_kwh: update.home_price_per_kwh,
            commercial_ac_price_per_kwh: update.commercial_ac_price_per_kwh,
            fast_dc_price_per_kwh: update.fast_dc_price_per_kwh,
          })
          .eq("id", update.id)
          .eq("user_id", profileUserId),
      ),
    ).then((results) => {
      setProviderPricesSaving(false);
      const error = results.find((r) => r.error)?.error;
      if (error) {
        toast.error(error.message);
        return;
      }
      void qc.invalidateQueries({ queryKey: queryKeys.userProviders });
      toast.success(t("settings.providerTariffs.saved") as string);
    });
  };

  const handleAddUserProvider = () => {
    if (!profileUserId || newProviderSaving) return;
    const label = newProviderLabel.trim();
    if (!label) {
      toast.error(t("settings.providerTariffs.providerNameRequired") as string);
      return;
    }
    const acInput = parseDecimalInput(newProviderAc);
    const dcInput = parseDecimalInput(newProviderDc);
    if (
      !Number.isFinite(acInput) ||
      !Number.isFinite(dcInput) ||
      acInput < 0 ||
      dcInput < 0
    ) {
      toast.error(t("settings.providerTariffs.invalidPrice") as string);
      return;
    }
    if (
      userProviderRows.some(
        (p) => p.label.toLowerCase() === label.toLowerCase(),
      )
    ) {
      toast.error(t("settings.providerTariffs.providerNameExists") as string);
      return;
    }
    setNewProviderSaving(true);
    void createClient()
      .from("user_providers")
      .insert({
        user_id: profileUserId,
        label,
        home_price_per_kwh: acInput,
        commercial_ac_price_per_kwh: acInput,
        fast_dc_price_per_kwh: dcInput,
      })
      .then(({ error }) => {
        setNewProviderSaving(false);
        if (error) {
          toast.error(error.message);
          return;
        }
        setNewProviderLabel("");
        setNewProviderAc("");
        setNewProviderDc("");
        void qc.invalidateQueries({ queryKey: queryKeys.userProviders });
        toast.success(t("settings.providerTariffs.added") as string);
      });
  };

  const handleToggleProvider = (providerId: string) => {
    setSelectedProviderIds((prev) =>
      prev.includes(providerId)
        ? prev.filter((id) => id !== providerId)
        : [...prev, providerId],
    );
  };

  const handleDeleteSelectedProviders = () => {
    if (!profileUserId || selectedProviderIds.length === 0) return;
    // Defensive: Home (is_default) never renders a checkbox, but guard anyway
    // in case selection state is ever stale.
    const deletableIds = selectedProviderIds.filter(
      (id) => !userProviderRows.find((p) => p.id === id)?.is_default,
    );
    if (deletableIds.length === 0) {
      setSelectedProviderIds([]);
      return;
    }
    void createClient()
      .from("user_providers")
      .delete()
      .in("id", deletableIds)
      .eq("user_id", profileUserId)
      .then(({ error }) => {
        setSelectedProviderIds([]);
        if (error) {
          toast.error(error.message);
          return;
        }
        void qc.invalidateQueries({ queryKey: queryKeys.userProviders });
        toast.success(t("settings.providerTariffs.deleted") as string);
      });
  };

  return (
    <div className="space-y-3 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
      <div>
        <p className="text-sm font-semibold tracking-tight">
          {t("settings.providerTariffs.userProvidersTitle") as string}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("settings.providerTariffs.userProvidersBody") as string}
        </p>
      </div>

      <form onSubmit={handleSaveProviderPrices} className="space-y-3">
        {userProviderRows.map((provider) => (
          <div key={provider.id} className="space-y-1.5">
            <div className="flex items-center gap-2">
              {!provider.is_default ? (
                <input
                  type="checkbox"
                  checked={selectedProviderIds.includes(provider.id)}
                  onChange={() => handleToggleProvider(provider.id)}
                  aria-label={`${provider.label} ${t("settings.providerTariffs.deleteSelected") as string}`}
                  className="size-4 accent-destructive"
                />
              ) : null}
              <Label className="text-sm">{provider.label}</Label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input
                key={`${provider.id}-ac-${provider.commercial_ac_price_per_kwh}`}
                name={`provider-${provider.id}-ac`}
                aria-label={`${provider.label} ${t("settings.providerTariffs.acLabel") as string}`}
                type="text"
                inputMode="decimal"
                pattern="[0-9]*[,.]?[0-9]*"
                defaultValue={String(provider.commercial_ac_price_per_kwh)}
                className="h-11 rounded-2xl text-sm"
              />
              <Input
                key={`${provider.id}-dc-${provider.fast_dc_price_per_kwh}`}
                name={`provider-${provider.id}-dc`}
                aria-label={`${provider.label} ${t("settings.providerTariffs.dcLabel") as string}`}
                type="text"
                inputMode="decimal"
                pattern="[0-9]*[,.]?[0-9]*"
                defaultValue={String(provider.fast_dc_price_per_kwh)}
                className="h-11 rounded-2xl text-sm"
              />
            </div>
          </div>
        ))}
        {selectedProviderIds.length > 0 ? (
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setSelectedProviderIds([])}
              className="text-xs text-muted-foreground underline underline-offset-2"
            >
              {t("settings.providerTariffs.cancelSelection") as string}
            </button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="h-9 rounded-full text-xs"
              onClick={handleDeleteSelectedProviders}
            >
              <Trash2 className="mr-1 size-3.5" />
              {t("settings.providerTariffs.deleteSelected") as string} (
              {selectedProviderIds.length})
            </Button>
          </div>
        ) : (
          <Button
            className="h-11 w-full rounded-full text-sm font-semibold"
            type="submit"
            disabled={providerPricesSaving}
          >
            {providerPricesSaving ? <Loader2 className="animate-spin" /> : null}
            {t("settings.providerTariffs.save") as string}
          </Button>
        )}
      </form>

      {selectedProviderIds.length === 0 ? (
        <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              {t("settings.providerTariffs.addProviderLabel") as string}
            </Label>
            <Input
              value={newProviderLabel}
              onChange={(e) => setNewProviderLabel(e.target.value)}
              placeholder={
                t("settings.providerTariffs.addProviderLabel") as string
              }
              className="h-10 rounded-xl text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              {t("settings.providerTariffs.addProviderAc") as string}
            </Label>
            <Input
              value={newProviderAc}
              onChange={(e) => setNewProviderAc(e.target.value)}
              type="text"
              inputMode="decimal"
              pattern="[0-9]*[,.]?[0-9]*"
              placeholder="0.00"
              className="h-10 rounded-xl text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              {t("settings.providerTariffs.addProviderDc") as string}
            </Label>
            <Input
              value={newProviderDc}
              onChange={(e) => setNewProviderDc(e.target.value)}
              type="text"
              inputMode="decimal"
              pattern="[0-9]*[,.]?[0-9]*"
              placeholder="0.00"
              className="h-10 rounded-xl text-sm"
            />
          </div>
          <Button
            type="button"
            onClick={handleAddUserProvider}
            disabled={newProviderSaving}
            className="h-10 rounded-xl text-sm"
          >
            {newProviderSaving ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              (t("settings.providerTariffs.addProviderSave") as string)
            )}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
