"use client";

import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { TariffLocationMapPreview } from "@/components/settings/tariff-location-map-preview";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useProfileQuery } from "@/hooks/use-profile-query";
import { useTariffLocationsQuery } from "@/hooks/use-tariff-locations-query";
import { useTranslation } from "@/hooks/use-translation";
import { useUserProvidersQuery } from "@/hooks/use-user-providers-query";
import { mapChargingTariffLocation } from "@/lib/db-map";
import { currencySymbols, type TranslationKey } from "@/lib/i18n";
import { parseDecimalInput } from "@/lib/number-input";
import { queryKeys } from "@/lib/query-keys";
import { createClient } from "@/lib/supabase/client";
import { useAppPreferences } from "@/stores/use-app-preferences";
import type {
  ChargingProviderType,
  ChargingTariffLocationRow,
  ChargingTariffType,
} from "@/types/database";

const tariffTypes = ["home", "commercial_ac", "fast_dc"] as const;

function parseLocationProviderValue(value: string | null | undefined): {
  providerType: ChargingProviderType;
  userProviderId: string | null;
} {
  if (typeof value === "string" && value.startsWith("up_")) {
    return { providerType: "user_provider", userProviderId: value.slice(3) };
  }
  return {
    providerType: (value as ChargingProviderType) ?? "custom",
    userProviderId: null,
  };
}

export function TariffLocationsSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const currency = useAppPreferences((s) => s.currency);
  const { data: profile } = useProfileQuery();
  const profileUserId = profile?.id ?? null;
  const { data: userProviderRows = [] } = useUserProvidersQuery();
  const { data: tariffLocations = [] } = useTariffLocationsQuery();

  const newLocationNameInputRef = useRef<HTMLInputElement>(null);
  const [newLocationName, setNewLocationName] = useState("");
  const [newLocationNameError, setNewLocationNameError] = useState(false);
  const [newLocationLat, setNewLocationLat] = useState("");
  const [newLocationLng, setNewLocationLng] = useState("");
  const [newLocationAutoGps, setNewLocationAutoGps] = useState(true);
  const [newLocationRadius, setNewLocationRadius] = useState("150");
  const [newLocationTariffType, setNewLocationTariffType] =
    useState<ChargingTariffType>("home");
  const [newLocationProviderType, setNewLocationProviderType] =
    useState<ChargingProviderType>("custom");
  const [newLocationUserProviderId, setNewLocationUserProviderId] = useState<
    string | null
  >(null);
  const [newLocationOverridePrice, setNewLocationOverridePrice] = useState("");

  // "custom" (manual price, no picked provider) is the only non-stored option —
  // every named provider (including Home) is a `user_providers` row, seeded on
  // signup so it's always at least present as Home.
  const locationProviderOptions = useMemo(() => {
    const userOpts = userProviderRows.map((p) => ({
      value: `up_${p.id}` as const,
      label: p.label,
    }));
    return [
      {
        value: "custom" as const,
        label: t(`charging.tariff.providers.custom` as TranslationKey),
      },
      ...userOpts,
    ];
  }, [userProviderRows, t]);

  const handleUseCurrentGps = () => {
    if (!navigator.geolocation) {
      toast.error(
        t("settings.locationTariffs.geolocationUnavailable") as string,
      );
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setNewLocationLat(String(position.coords.latitude));
        setNewLocationLng(String(position.coords.longitude));
      },
      (error) => toast.error(error.message),
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 },
    );
  };

  const handleToggleAutoGps = () => {
    const next = !newLocationAutoGps;
    setNewLocationAutoGps(next);
    if (next && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setNewLocationLat(String(position.coords.latitude));
          setNewLocationLng(String(position.coords.longitude));
        },
        () => {},
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
      );
    }
  };

  const handleAddTariffLocation = () => {
    if (!newLocationName.trim()) {
      setNewLocationNameError(true);
      newLocationNameInputRef.current?.focus();
      toast.error(t("settings.locationTariffs.nameRequired") as string);
      return;
    }
    if (!profileUserId) {
      toast.error(t("settings.locationTariffs.signInRequired") as string);
      return;
    }
    const lat = parseDecimalInput(newLocationLat);
    const lng = parseDecimalInput(newLocationLng);
    const radiusM = parseDecimalInput(newLocationRadius);
    const override = parseDecimalInput(newLocationOverridePrice);
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      !Number.isFinite(radiusM) ||
      radiusM <= 0
    ) {
      toast.error(t("settings.locationTariffs.invalidCoords") as string);
      return;
    }

    void createClient()
      .from("charging_tariff_locations")
      .insert({
        user_id: profileUserId,
        name: newLocationName.trim(),
        lat,
        lng,
        radius_m: radiusM,
        tariff_type: newLocationTariffType,
        provider_type: newLocationProviderType,
        user_provider_id: newLocationUserProviderId,
        price_per_kwh_override:
          Number.isFinite(override) && override > 0 ? override : null,
      })
      .select("*")
      .single()
      .then(({ data, error }) => {
        if (error || !data) {
          toast.error(
            error?.message ??
              (t("settings.toasts.saveLocationError") as string),
          );
          return;
        }
        const mapped = mapChargingTariffLocation(
          data as Record<string, unknown>,
        );
        qc.setQueryData<ChargingTariffLocationRow[]>(
          queryKeys.tariffLocations,
          (prev) => [
            mapped,
            ...(prev ?? []).filter((item) => item.id !== mapped.id),
          ],
        );
        setNewLocationName("");
        setNewLocationNameError(false);
        setNewLocationOverridePrice("");
        toast.success(t("settings.locationTariffs.saved") as string);
      });
  };

  const handleDeleteTariffLocation = (id: string) => {
    const previous = tariffLocations;
    qc.setQueryData<ChargingTariffLocationRow[]>(
      queryKeys.tariffLocations,
      (list) => (list ?? []).filter((item) => item.id !== id),
    );
    void createClient()
      .from("charging_tariff_locations")
      .delete()
      .eq("id", id)
      .then(({ error }) => {
        if (error) {
          qc.setQueryData(queryKeys.tariffLocations, previous);
          toast.error(error.message);
          return;
        }
        toast.success(t("settings.toasts.locationRemoved") as string);
      });
  };

  const parsedNewLocationLat = Number.parseFloat(newLocationLat);
  const parsedNewLocationLng = Number.parseFloat(newLocationLng);
  const hasNewLocationCoords =
    Number.isFinite(parsedNewLocationLat) &&
    Number.isFinite(parsedNewLocationLng);
  const tariffMapLat = hasNewLocationCoords
    ? parsedNewLocationLat
    : (tariffLocations[0]?.lat ?? 53.9023);
  const tariffMapLng = hasNewLocationCoords
    ? parsedNewLocationLng
    : (tariffLocations[0]?.lng ?? 27.5619);

  return (
    <div className="space-y-4 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
      <p className="text-sm font-semibold tracking-tight">
        {t("settings.locationTariffs.title") as string}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Input
            ref={newLocationNameInputRef}
            placeholder={
              t("settings.locationTariffs.namePlaceholder") as string
            }
            value={newLocationName}
            onChange={(event) => {
              setNewLocationName(event.target.value);
              if (event.target.value.trim()) {
                setNewLocationNameError(false);
              }
            }}
            aria-invalid={newLocationNameError}
            aria-describedby={
              newLocationNameError ? "tariff-location-name-error" : undefined
            }
            className="h-11 rounded-2xl text-sm"
          />
          {newLocationNameError ? (
            <p
              id="tariff-location-name-error"
              className="px-1 text-xs font-medium text-destructive"
            >
              {t("settings.locationTariffs.nameRequired") as string}
            </p>
          ) : null}
        </div>
        <Button
          type="button"
          variant="outline"
          className="h-11 rounded-full text-sm"
          onClick={handleUseCurrentGps}
        >
          {t("settings.locationTariffs.useCurrentGps") as string}
        </Button>
        <Button
          type="button"
          variant={newLocationAutoGps ? "secondary" : "outline"}
          className="h-11 rounded-full text-sm"
          onClick={handleToggleAutoGps}
        >
          {newLocationAutoGps
            ? (t("settings.locationTariffs.autoGpsOn") as string)
            : (t("settings.locationTariffs.autoGpsOff") as string)}
        </Button>
        <Input
          placeholder={
            t("settings.locationTariffs.radiusPlaceholder") as string
          }
          value={newLocationRadius}
          onChange={(event) => setNewLocationRadius(event.target.value)}
          className="h-11 rounded-2xl text-sm"
        />
        <Select
          value={newLocationTariffType}
          onValueChange={(value) =>
            setNewLocationTariffType(value as ChargingTariffType)
          }
          items={tariffTypes.map((value) => ({
            value,
            label: t(`charging.tariff.types.${value}` as TranslationKey),
          }))}
        >
          <SelectTrigger className="h-11 rounded-2xl text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {tariffTypes.map((value) => (
              <SelectItem key={value} value={value}>
                {t(`charging.tariff.types.${value}` as TranslationKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={
            newLocationUserProviderId
              ? `up_${newLocationUserProviderId}`
              : newLocationProviderType
          }
          onValueChange={(value) => {
            const parsed = parseLocationProviderValue(value);
            setNewLocationProviderType(parsed.providerType);
            setNewLocationUserProviderId(parsed.userProviderId);
          }}
          items={locationProviderOptions.map((item) => ({
            value: item.value,
            label: item.label,
          }))}
        >
          <SelectTrigger className="h-11 rounded-2xl text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {locationProviderOptions.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <TariffLocationMapPreview lat={tariffMapLat} lng={tariffMapLng} />
      {hasNewLocationCoords ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {t("settings.locationTariffs.pointCoords", {
              lat: parsedNewLocationLat.toFixed(6),
              lon: parsedNewLocationLng.toFixed(6),
            })}
          </p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {t("settings.locationTariffs.gpsPending") as string}
        </p>
      )}
      <Input
        placeholder={
          t("settings.locationTariffs.optionalPrice", {
            currency: currencySymbols[currency],
          }) as string
        }
        value={newLocationOverridePrice}
        onChange={(event) => setNewLocationOverridePrice(event.target.value)}
        className="h-11 rounded-2xl text-sm"
      />
      <Button
        type="button"
        className="h-11 w-full rounded-full text-sm font-semibold"
        onClick={handleAddTariffLocation}
      >
        {t("settings.locationTariffs.save") as string}
      </Button>
      <div className="space-y-2">
        {tariffLocations.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t("settings.locationTariffs.empty") as string}
          </p>
        ) : (
          tariffLocations.map((location) => (
            <div
              key={location.id}
              className="flex items-center justify-between rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-2"
            >
              <div>
                <p className="text-sm font-medium">{location.name}</p>
                <p className="text-xs text-muted-foreground">
                  {location.provider_type} · {location.tariff_type} ·{" "}
                  {location.radius_m} m · {location.lat.toFixed(5)},{" "}
                  {location.lng.toFixed(5)}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 rounded-full text-xs"
                onClick={() => handleDeleteTariffLocation(location.id)}
              >
                {t("settings.locationTariffs.delete") as string}
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
