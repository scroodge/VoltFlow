"use client";

import Link from "next/link";
import { Bell, ChevronDown, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Code2,
  ExternalLink,
  KeyRound,
  Loader2,
  MessageCircle,
  Scale,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { deleteCar } from "@/actions/cars";
import { deleteAccount } from "@/actions/account";
import { sendTestPush } from "@/actions/push";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { LegalSettingsRow } from "@/components/legal/legal-document-view";
import { currencyTextWithIcon } from "@/components/currency-amount";
import { FreeRetentionNotice } from "@/components/premium/free-retention-notice";
import { PremiumBadge } from "@/components/premium/premium-badge";
import { ClusterBackgroundsSettings } from "@/components/settings/cluster-backgrounds-settings";
import {
  SettingsGroup,
  SettingsGroupDivider,
  SettingsPageHeader,
} from "@/components/settings/settings-section";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useCarsQuery } from "@/hooks/use-cars-query";
import { usePairedDevicesQuery } from "@/hooks/use-paired-devices-query";
import { useUserProvidersQuery } from "@/hooks/use-user-providers-query";
import { useTranslation } from "@/hooks/use-translation";
import { sendPasswordResetEmail } from "@/lib/auth/password-reset";
import { telegramApiUrl } from "@/lib/telegram/api-url";
import { isTelegramWebView } from "@/lib/telegram/environment";
import {
  currencies,
  currencyLabels,
  currencySymbols,
  isCurrency,
  isLocale,
  type Currency,
  type Locale,
  type TranslationKey,
} from "@/lib/i18n";
import { legalDocumentPath } from "@/lib/legal-region";
import { parseDecimalInput } from "@/lib/number-input";
import {
  defaultPressureUnit,
  isPressureUnit,
  pressureUnits,
  type PressureUnit,
} from "@/lib/pressure-units";
import { devFetch, isDevAppRoute } from "@/lib/dev/dev-fetch";
import { useAppPath } from "@/lib/dev/dev-path";
import { mapChargingTariffLocation, mapUserProvider } from "@/lib/db-map";
import { queryKeys } from "@/lib/query-keys";
import {
  auxBatteryChemistries,
  deriveAuxBatteryChemistry,
  type AuxBatteryChemistry,
} from "@/lib/vehicle/aux-battery-chemistry";
import {
  ensureNotificationsPermission,
  ensurePushSubscription,
  getPushClientStatus,
  showLocalTestNotification,
} from "@/lib/push/client";
import { useAppPreferences } from "@/stores/use-app-preferences";
import { clearPrivateBrowserData } from "@/lib/privacy/client";
import { VoltflowMateConnection } from "@/components/settings/voltflow-mate-connection";
import { PressureUnitSelector } from "@/components/settings/pressure-unit-selector";
import { UserSettings } from "@/components/settings/user-settings";
import { useEntitlementQuery } from "@/hooks/use-entitlement-query";
import { EconomicsSettings } from "./economic-settings";
import type {
  Car,
  ChargingProviderType,
  ChargingTariffLocationRow,
  ChargingTariffType,
  Profile,
} from "@/types/database";

type NotifyChannel = "web_push" | "telegram" | "both";

const notifyChannels = ["web_push", "telegram", "both"] as const;

function isNotifyChannel(value: unknown): value is NotifyChannel {
  return (
    typeof value === "string" && notifyChannels.includes(value as NotifyChannel)
  );
}

type LiveStatusMode = "off" | "charging" | "charging_parked";

const liveStatusModes = ["off", "charging", "charging_parked"] as const;

function isLiveStatusMode(value: unknown): value is LiveStatusMode {
  return (
    typeof value === "string" &&
    liveStatusModes.includes(value as LiveStatusMode)
  );
}

function TariffLocationMapPreview({ lat, lng }: { lat: number; lng: number }) {
  const { t } = useTranslation();
  const latDelta = 0.006;
  const lngDelta = 0.012;
  const params = new URLSearchParams({
    bbox: [lng - lngDelta, lat - latDelta, lng + lngDelta, lat + latDelta].join(
      ",",
    ),
    layer: "mapnik",
    marker: `${lat},${lng}`,
  });
  const osmUrl = `https://www.openstreetmap.org/export/embed.html?${params.toString()}`;
  const externalUrl = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`;

  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.02]">
      <iframe
        title={t("settings.tariffMapTitle") as string}
        src={osmUrl}
        className="h-64 w-full border-0"
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
      />
      <div className="border-t border-white/[0.08] px-3 py-2 text-xs">
        <a
          href={externalUrl}
          target="_blank"
          rel="noreferrer"
          className="text-muted-foreground transition hover:text-foreground"
        >
          {t("settings.openInOsm")}
        </a>
      </div>
    </div>
  );
}

export function SettingsView({ isAdmin = false }: { isAdmin?: boolean }) {
  const router = useRouter();
  const appPath = useAppPath();
  const { data: carsResult, isLoading } = useCarsQuery();
  const cars = carsResult?.cars;
  const [email, setEmail] = useState<string | null>(null);
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [telegramId, setTelegramId] = useState<number | null>(null);
  const [telegramUsername, setTelegramUsername] = useState<string | null>(null);
  const [notifyChannel, setNotifyChannel] = useState<NotifyChannel>("web_push");
  const [liveStatusMode, setLiveStatusMode] =
    useState<LiveStatusMode>("charging");
  const [auxBatteryAlertsEnabled, setAuxBatteryAlertsEnabled] = useState(true);
  const [pressureUnit, setPressureUnit] =
    useState<PressureUnit>(defaultPressureUnit);
  const [pressureUnitSaving, setPressureUnitSaving] = useState(false);
  const [telegramInstructionsOpen, setTelegramInstructionsOpen] =
    useState(false);
  const [securityBusy, setSecurityBusy] = useState(false);
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [deleteAccountText, setDeleteAccountText] = useState("");
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [telegramBusy, setTelegramBusy] = useState(false);
  const newLocationNameInputRef = useRef<HTMLInputElement>(null);
  const homePricePerKwh = useAppPreferences((s) => s.homePricePerKwh);
  const commercialAcPricePerKwh = useAppPreferences(
    (s) => s.commercialAcPricePerKwh,
  );
  const fastDcPricePerKwh = useAppPreferences((s) => s.fastDcPricePerKwh);
  const setDefaultPrice = useAppPreferences((s) => s.setDefaultPricePerKwh);
  const setTariffPrices = useAppPreferences((s) => s.setTariffPrices);
  const currency = useAppPreferences((s) => s.currency);
  const setCurrency = useAppPreferences((s) => s.setCurrency);
  const setLocale = useAppPreferences((s) => s.setLocale);
  const [tariffLocations, setTariffLocations] = useState<
    ChargingTariffLocationRow[]
  >([]);
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
  const [tariffSaveState, setTariffSaveState] = useState<
    "idle" | "saving" | "saved"
  >("idle");
  const tariffSavedResetRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: userProviderRows = [] } = useUserProvidersQuery();

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
  const [providerPricesSaving, setProviderPricesSaving] = useState(false);
  const [newProviderLabel, setNewProviderLabel] = useState("");
  const [newProviderAc, setNewProviderAc] = useState("");
  const [newProviderDc, setNewProviderDc] = useState("");
  const [selectedProviderIds, setSelectedProviderIds] = useState<string[]>([]);
  const [newProviderSaving, setNewProviderSaving] = useState(false);

  useEffect(() => {
    return () => {
      if (tariffSavedResetRef.current)
        clearTimeout(tariffSavedResetRef.current);
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    if (isDevAppRoute()) {
      void devFetch("/api/vehicle/profile").then(async (response) => {
        if (!mounted || !response.ok) return;
        const payload = (await response.json()) as {
          email?: string | null;
          profile?: {
            id?: string;
            preferred_currency?: string;
            preferred_pressure_unit?: string;
            default_price_per_kwh?: number;
            home_price_per_kwh?: number;
            commercial_ac_price_per_kwh?: number;
            fast_dc_price_per_kwh?: number;
            telegram_id?: number | null;
            telegram_username?: string | null;
            notify_channel?: string | null;
            live_status_mode?: string | null;
            aux_battery_alerts_enabled?: boolean | null;
          } | null;
          tariffLocations?: Record<string, unknown>[];
        };

        setEmail(payload.email ?? null);
        setProfileUserId(payload.profile?.id ?? null);
        setTelegramId(
          typeof payload.profile?.telegram_id === "number"
            ? payload.profile.telegram_id
            : null,
        );
        setTelegramUsername(
          typeof payload.profile?.telegram_username === "string"
            ? payload.profile.telegram_username
            : null,
        );
        if (isNotifyChannel(payload.profile?.notify_channel)) {
          setNotifyChannel(payload.profile.notify_channel);
        }
        if (isLiveStatusMode(payload.profile?.live_status_mode)) {
          setLiveStatusMode(payload.profile.live_status_mode);
        }
        setAuxBatteryAlertsEnabled(
          payload.profile?.aux_battery_alerts_enabled !== false,
        );

        const preferredCurrency = payload.profile?.preferred_currency;
        if (
          typeof preferredCurrency === "string" &&
          isCurrency(preferredCurrency)
        ) {
          setCurrency(preferredCurrency);
        }
        if (isPressureUnit(payload.profile?.preferred_pressure_unit)) {
          setPressureUnit(payload.profile.preferred_pressure_unit);
        }

        const homePrice = Number(
          payload.profile?.home_price_per_kwh ??
            payload.profile?.default_price_per_kwh,
        );
        const commercialPrice = Number(
          payload.profile?.commercial_ac_price_per_kwh ??
            payload.profile?.default_price_per_kwh,
        );
        const dcPrice = Number(
          payload.profile?.fast_dc_price_per_kwh ??
            payload.profile?.default_price_per_kwh,
        );
        if (
          Number.isFinite(homePrice) &&
          Number.isFinite(commercialPrice) &&
          Number.isFinite(dcPrice) &&
          homePrice >= 0 &&
          commercialPrice >= 0 &&
          dcPrice >= 0
        ) {
          setTariffPrices({
            homePricePerKwh: homePrice,
            commercialAcPricePerKwh: commercialPrice,
            fastDcPricePerKwh: dcPrice,
          });
        }
        setTariffLocations(
          (payload.tariffLocations ?? []).map((row) =>
            mapChargingTariffLocation(row),
          ),
        );
      });

      return () => {
        mounted = false;
      };
    }

    const supabase = createClient();

    void supabase.auth.getUser().then(async ({ data }) => {
      const user = data.user;
      if (!mounted) return;

      setEmail(user?.email ?? null);
      setProfileUserId(user?.id ?? null);
      if (!user) return;

      const [{ data: profile, error }, { data: locationRows }] =
        await Promise.all([
          supabase
            .from("profiles")
            .select(
              "preferred_currency, preferred_pressure_unit, default_price_per_kwh, home_price_per_kwh, commercial_ac_price_per_kwh, fast_dc_price_per_kwh, telegram_id, telegram_username, notify_channel, live_status_mode, aux_battery_alerts_enabled",
            )
            .eq("id", user.id)
            .single(),
          supabase
            .from("charging_tariff_locations")
            .select("*")
            .eq("user_id", user.id),
        ]);

      if (!mounted || error) return;

      setTelegramId(
        typeof profile?.telegram_id === "number" ? profile.telegram_id : null,
      );
      setTelegramUsername(
        typeof profile?.telegram_username === "string"
          ? profile.telegram_username
          : null,
      );
      if (isNotifyChannel(profile?.notify_channel)) {
        setNotifyChannel(profile.notify_channel);
      }
      if (isLiveStatusMode(profile?.live_status_mode)) {
        setLiveStatusMode(profile.live_status_mode);
      }
      setAuxBatteryAlertsEnabled(profile?.aux_battery_alerts_enabled !== false);

      const preferredCurrency = profile?.preferred_currency;
      if (
        typeof preferredCurrency === "string" &&
        isCurrency(preferredCurrency)
      ) {
        setCurrency(preferredCurrency);
      }
      if (isPressureUnit(profile?.preferred_pressure_unit)) {
        setPressureUnit(profile.preferred_pressure_unit);
      }

      const homePrice = Number(
        profile?.home_price_per_kwh ?? profile?.default_price_per_kwh,
      );
      const commercialPrice = Number(
        profile?.commercial_ac_price_per_kwh ?? profile?.default_price_per_kwh,
      );
      const dcPrice = Number(
        profile?.fast_dc_price_per_kwh ?? profile?.default_price_per_kwh,
      );
      if (
        Number.isFinite(homePrice) &&
        Number.isFinite(commercialPrice) &&
        Number.isFinite(dcPrice) &&
        homePrice >= 0 &&
        commercialPrice >= 0 &&
        dcPrice >= 0
      ) {
        setTariffPrices({
          homePricePerKwh: homePrice,
          commercialAcPricePerKwh: commercialPrice,
          fastDcPricePerKwh: dcPrice,
        });
      }

      setTariffLocations(
        (locationRows ?? []).map((row) =>
          mapChargingTariffLocation(row as Record<string, unknown>),
        ),
      );
    });

    return () => {
      mounted = false;
    };
  }, [setCurrency, setDefaultPrice, setTariffPrices]);

  const markTariffSaved = () => {
    setTariffSaveState("saved");
    if (tariffSavedResetRef.current) clearTimeout(tariffSavedResetRef.current);
    tariffSavedResetRef.current = setTimeout(
      () => setTariffSaveState("idle"),
      2_000,
    );
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

    if (!profileUserId) {
      toast.success(t("settings.tariffSaved") as string);
      markTariffSaved();
      return;
    }

    setTariffSaveState("saving");
    const save = (async () => {
      const { error } = await createClient()
        .from("profiles")
        .update({
          default_price_per_kwh: homeNumeric,
          home_price_per_kwh: homeNumeric,
          commercial_ac_price_per_kwh: acNumeric,
          fast_dc_price_per_kwh: dcNumeric,
        })
        .eq("id", profileUserId);
      if (error) throw new Error(error.message);
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

  const handleUseCurrentGps = () => {
    if (!navigator.geolocation) {
      toast.error(
        t("settings.locationTariffs.geolocationUnavailable") as string,
      );
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;
        setNewLocationLat(String(lat));
        setNewLocationLng(String(lon));
      },
      (error) => toast.error(error.message),
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 },
    );
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
        setTariffLocations((prev) => [
          mapped,
          ...prev.filter((item) => item.id !== mapped.id),
        ]);
        setNewLocationName("");
        setNewLocationNameError(false);
        setNewLocationOverridePrice("");
        toast.success(t("settings.locationTariffs.saved") as string);
      });
  };

  const handleDeleteTariffLocation = (id: string) => {
    const previous = tariffLocations;
    setTariffLocations((list) => list.filter((item) => item.id !== id));
    void createClient()
      .from("charging_tariff_locations")
      .delete()
      .eq("id", id)
      .then(({ error }) => {
        if (error) {
          setTariffLocations(previous);
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

  const handleCurrencyChange = (value: Currency | null) => {
    if (!value || !isCurrency(value)) return;
    const previous = currency;
    setCurrency(value);

    if (!profileUserId) {
      toast.success(t("settings.currencySaved") as string);
      return;
    }

    void createClient()
      .from("profiles")
      .update({ preferred_currency: value })
      .eq("id", profileUserId)
      .then(({ error }) => {
        if (error) {
          setCurrency(previous);
          toast.error(error.message);
          return;
        }
        toast.success(t("settings.currencySaved") as string);
      });
  };

  const handleLocaleChange = (value: Locale, previous: Locale) => {
    if (!isLocale(value)) return;

    if (!profileUserId) {
      toast.success(t("settings.localeSaved") as string);
      return;
    }

    void createClient()
      .from("profiles")
      .update({ preferred_locale: value })
      .eq("id", profileUserId)
      .then(({ error }) => {
        if (error) {
          setLocale(previous);
          toast.error(error.message);
          return;
        }
        toast.success(t("settings.localeSaved") as string);
      });
  };
  const handlePressureUnitChange = (value: PressureUnit | null) => {
    if (!value || !isPressureUnit(value) || !profileUserId) return;

    const previous = pressureUnit;
    setPressureUnit(value);
    setPressureUnitSaving(true);
    qc.setQueryData<Profile | null>(queryKeys.profile, (profile) =>
      profile ? { ...profile, preferred_pressure_unit: value } : profile,
    );

    void (async () => {
      try {
        const { error } = await createClient()
          .from("profiles")
          .update({ preferred_pressure_unit: value })
          .eq("id", profileUserId);

        if (error) {
          setPressureUnit(previous);
          qc.setQueryData<Profile | null>(queryKeys.profile, (profile) =>
            profile
              ? { ...profile, preferred_pressure_unit: previous }
              : profile,
          );
          toast.error(error.message);
          return;
        }
        toast.success(t("settings.pressureUnit.saved") as string);
      } finally {
        setPressureUnitSaving(false);
      }
    })();
  };

  const handleSignOut = async () => {
    debugger;
    if (isDevAppRoute()) {
      toast.message(t("settings.toasts.devSignOutDisabled") as string);
      return;
    }
    const returnPath = isTelegramWebView() ? "/telegram" : "/login";
    const supabase = createClient();
    await clearPrivateBrowserData();
    await supabase.auth.signOut();
    toast.success(t("settings.signedOut") as string);
    router.replace(returnPath);
    router.refresh();
  };

  const handleAddPassword = async () => {
    if (!email) {
      toast.error(t("settings.security.emailMissing") as string);
      return;
    }

    setSecurityBusy(true);
    try {
      const result = await sendPasswordResetEmail(email);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(t("settings.security.resetSent") as string);
    } finally {
      setSecurityBusy(false);
    }
  };

  const handleConnectTelegram = async () => {
    const webApp =
      typeof window !== "undefined" ? window.Telegram?.WebApp : undefined;
    const initData = webApp?.initData ?? "";
    if (!initData) {
      setTelegramInstructionsOpen(true);
      toast.message(t("settings.telegramConnect.openInTelegram") as string);
      return;
    }

    setTelegramBusy(true);
    try {
      const {
        data: { session },
      } = await createClient().auth.getSession();
      const response = await fetch(telegramApiUrl("/api/telegram/link"), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(session?.access_token
            ? { authorization: `Bearer ${session.access_token}` }
            : {}),
        },
        body: JSON.stringify({ initData }),
      });
      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean;
        telegram_id?: number;
        error?: string;
      } | null;
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error ?? "link_failed");
      }
      setTelegramId(
        payload.telegram_id ?? webApp?.initDataUnsafe?.user?.id ?? null,
      );
      setTelegramUsername(webApp?.initDataUnsafe?.user?.username ?? null);
      setTelegramInstructionsOpen(false);
      toast.success(t("settings.telegramConnect.linked") as string);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : String(t("settings.telegramConnect.linkFailed")),
      );
    } finally {
      setTelegramBusy(false);
    }
  };

  const handleNotifyChannelChange = (value: string | null) => {
    if (!isNotifyChannel(value)) return;
    if ((value === "telegram" || value === "both") && !telegramId) {
      setTelegramInstructionsOpen(true);
      toast.error(t("settings.telegramConnect.connectFirst") as string);
      return;
    }

    const previous = notifyChannel;
    setNotifyChannel(value);

    if (!profileUserId) {
      toast.success(t("settings.telegramConnect.channelSaved") as string);
      return;
    }

    void createClient()
      .from("profiles")
      .update({ notify_channel: value })
      .eq("id", profileUserId)
      .then(({ error }) => {
        if (error) {
          setNotifyChannel(previous);
          toast.error(error.message);
          return;
        }
        toast.success(t("settings.telegramConnect.channelSaved") as string);
      });
  };

  const handleLiveStatusModeChange = (value: string | null) => {
    if (!isLiveStatusMode(value)) return;

    const previous = liveStatusMode;
    setLiveStatusMode(value);

    if (!profileUserId) {
      toast.success(t("settings.liveStatus.saved") as string);
      return;
    }

    void createClient()
      .from("profiles")
      .update({ live_status_mode: value })
      .eq("id", profileUserId)
      .then(({ error }) => {
        if (error) {
          setLiveStatusMode(previous);
          toast.error(error.message);
          return;
        }
        toast.success(t("settings.liveStatus.saved") as string);
      });
  };

  const handleAuxBatteryAlertsChange = (value: string | null) => {
    const enabled = value === "enabled";
    if (value !== "enabled" && value !== "disabled") return;
    const previous = auxBatteryAlertsEnabled;
    setAuxBatteryAlertsEnabled(enabled);
    if (!profileUserId) return;
    void createClient()
      .from("profiles")
      .update({ aux_battery_alerts_enabled: enabled })
      .eq("id", profileUserId)
      .then(({ error }) => {
        if (error) {
          setAuxBatteryAlertsEnabled(previous);
          toast.error(error.message);
          return;
        }
        toast.success(
          t("settings.telegramConnect.auxBatteryAlertsSaved") as string,
        );
      });
  };

  const { data } = useEntitlementQuery();

  return (
    <div className="flex flex-col gap-3 px-4 pb-5 pt-3">
      <SettingsPageHeader
        eyebrow={String(t("settings.eyebrow"))}
        title={String(t("settings.title"))}
        // subtitle={String(t("settings.subtitle"))}
      />
      <FreeRetentionNotice />
      <Card>
        <CardContent>
          <Separator className="my-6 bg-white/15" />

          <div className="space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-3">
                <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
                  {t("settings.housekeeping")}
                </p>
                {/* <p className="text-sm leading-relaxed text-muted-foreground">
                  {t("settings.housekeepingBody")}
                </p> */}
              </div>
              <Button
                asChild
                variant="secondary"
                className="h-10 rounded-full text-sm"
              >
                <Link href={appPath("/cars/new")}>{t("settings.addEv")}</Link>
              </Button>
            </div>
            <div className="space-y-5">
              {isLoading &&
                Array.from({ length: 2 }).map((_, index) => (
                  <Skeleton
                    key={index}
                    className="h-[120px] w-full rounded-3xl"
                  />
                ))}
              {!isLoading &&
                cars?.map((car) => <CarRow key={car.id} car={car} />)}
              {!isLoading && !(cars ?? []).length ? (
                <p className="text-muted-foreground text-base leading-relaxed">
                  {t("settings.noRides")}
                </p>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>

      <PressureUnitSelector
        profileUserId={profileUserId}
        pressureUnit={pressureUnit}
        pressureUnits={pressureUnits}
        pressureUnitSaving={pressureUnitSaving}
        onPressureUnitChange={handlePressureUnitChange}
      />

      <UserSettings
        email={email}
        handleSignOut={handleSignOut}
        deleteAccountOpen={deleteAccountOpen}
        deleteAccountText={deleteAccountText}
        deleteAccount={deleteAccount}
        deletingAccount={deletingAccount}
        clearPrivateBrowserData={clearPrivateBrowserData}
        setDeleteAccountText={setDeleteAccountText}
        setDeletingAccount={setDeletingAccount}
        setDeleteAccountOpen={setDeleteAccountOpen}
        handleAddPassword={handleAddPassword}
        securityBusy={securityBusy}
        notifyChannel={notifyChannel}
        handleNotifyChannelChange={handleNotifyChannelChange}
        telegramId={telegramId}
        telegramUsername={telegramUsername}
        handleConnectTelegram={handleConnectTelegram}
        telegramBusy={telegramBusy}
        telegramInstructionsOpen={telegramInstructionsOpen}
        liveStatusMode={liveStatusMode}
        handleLiveStatusModeChange={handleLiveStatusModeChange}
        liveStatusModes={liveStatusModes}
        notifyChannels={notifyChannels}
        auxBatteryAlertsEnabled={auxBatteryAlertsEnabled}
        handleAuxBatteryAlertsChange={handleAuxBatteryAlertsChange}
      />

      {isAdmin ? <PushDiagnostics /> : null}

      {isAdmin ? (
        <Card size="sm" className="border-white/[0.08]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck
                className="size-5 text-[var(--voltflow-green)]"
                aria-hidden
              />
              {t("settings.adminCms.title")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-muted-foreground text-sm leading-relaxed">
              {t("settings.adminCms.description")}
            </p>
            <Button
              asChild
              variant="secondary"
              size="lg"
              className="h-11 w-full justify-between rounded-full px-4 text-sm font-semibold"
            >
              <Link href="/admin/knowledge">
                <span className="inline-flex items-center gap-3">
                  <ShieldCheck className="size-5" aria-hidden />
                  {t("settings.adminCms.open")}
                </span>
                <ExternalLink className="size-4" aria-hidden />
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {isAdmin ? (
        <Card size="sm" className="border-white/[0.08]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck
                className="size-5 text-[var(--voltflow-cyan)]"
                aria-hidden
              />
              {t("settings.adminPremium.title")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-muted-foreground text-sm leading-relaxed">
              {t("settings.adminPremium.description")}
            </p>
            <Button
              asChild
              variant="secondary"
              size="lg"
              className="h-11 w-full justify-between rounded-full px-4 text-sm font-semibold"
            >
              <Link href="/admin/users">
                <span className="inline-flex items-center gap-3">
                  <ShieldCheck className="size-5" aria-hidden />
                  {t("settings.adminPremium.open")}
                </span>
                <ExternalLink className="size-4" aria-hidden />
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <VoltflowMateConnection profileUserId={profileUserId} />
      {data?.isPremium ? (
        <Card>
          <DashboardVersionPanel />
          <ClusterBackgroundsSettings />
        </Card>
      ) : null}

      <EconomicsSettings
        handleCurrencyChange={handleCurrencyChange}
        handlePriceSave={handlePriceSave}
        currency={currency}
        currencyLabels={currencyLabels}
        currencies={currencies}
        homePricePerKwh={homePricePerKwh}
        currencyTextWithIcon={currencyTextWithIcon}
        currencySymbols={currencySymbols}
        commercialAcPricePerKwh={commercialAcPricePerKwh}
        fastDcPricePerKwh={fastDcPricePerKwh}
        tariffSaveState={tariffSaveState}
        handleSaveProviderPrices={handleSaveProviderPrices}
        userProviderRows={userProviderRows}
        selectedProviderIds={selectedProviderIds}
        handleToggleProvider={handleToggleProvider}
        setSelectedProviderIds={setSelectedProviderIds}
        handleDeleteSelectedProviders={handleDeleteSelectedProviders}
        providerPricesSaving={providerPricesSaving}
        newProviderLabel={newProviderLabel}
        setNewProviderLabel={setNewProviderLabel}
        newProviderAc={newProviderAc}
        setNewProviderAc={setNewProviderAc}
        newProviderDc={newProviderDc}
        setNewProviderDc={setNewProviderDc}
        newLocationNameInputRef={newLocationNameInputRef}
        newLocationName={newLocationName}
        handleAddUserProvider={handleAddUserProvider}
        newProviderSaving={newProviderSaving}
        setNewLocationName={setNewLocationName}
        setNewLocationNameError={setNewLocationNameError}
        newLocationNameError={newLocationNameError}
        handleUseCurrentGps={handleUseCurrentGps}
        newLocationAutoGps={newLocationAutoGps}
        setNewLocationAutoGps={setNewLocationAutoGps}
        setNewLocationLat={setNewLocationLat}
        setNewLocationLng={setNewLocationLng}
        newLocationRadius={newLocationRadius}
        setNewLocationRadius={setNewLocationRadius}
        newLocationTariffType={newLocationTariffType}
        setNewLocationTariffType={setNewLocationTariffType}
        newLocationUserProviderId={newLocationUserProviderId}
        newLocationProviderType={newLocationProviderType}
        parseLocationProviderValue={parseLocationProviderValue}
        setNewLocationProviderType={setNewLocationProviderType}
        setNewLocationUserProviderId={setNewLocationUserProviderId}
        locationProviderOptions={locationProviderOptions}
        TariffLocationMapPreview={TariffLocationMapPreview}
        tariffMapLat={tariffMapLat}
        tariffMapLng={tariffMapLng}
        hasNewLocationCoords={hasNewLocationCoords}
        parsedNewLocationLat={parsedNewLocationLat}
        parsedNewLocationLng={parsedNewLocationLng}
        newLocationOverridePrice={newLocationOverridePrice}
        setNewLocationOverridePrice={setNewLocationOverridePrice}
        handleAddTariffLocation={handleAddTariffLocation}
        tariffLocations={tariffLocations}
        handleDeleteTariffLocation={handleDeleteTariffLocation}
      />
      <Card size="sm" className="border-white/[0.08]">
        <CardHeader>
          <CardTitle>{t("settings.legal.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 px-0 pb-1">
          <p className="text-muted-foreground px-4 text-sm leading-relaxed">
            {t("settings.legal.description")}
          </p>
          <SettingsGroup className="mx-4">
            <LegalSettingsRow
              href={legalDocumentPath("privacy", "world")}
              label={String(t("settings.legal.privacy"))}
            />
            <SettingsGroupDivider />
            <LegalSettingsRow
              href={legalDocumentPath("terms", "world")}
              label={String(t("settings.legal.terms"))}
            />
          </SettingsGroup>
        </CardContent>
      </Card>

      <Card size="sm" className="border-white/[0.08]">
        <CardHeader>
          <CardTitle>{t("locale.label")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <LocaleSwitcher onLocaleChange={handleLocaleChange} />
          <p className="text-muted-foreground text-sm">{t("locale.helper")}</p>
        </CardContent>
      </Card>

      <AboutSection />
    </div>
  );
}

/**
 * Which VoltFlow Dashboard build is linked to this account.
 *
 * Deliberately not modelled on Mate's version panel: Mate's version rides its
 * telemetry stream, while the Dashboard sends no telemetry and reports its build on the
 * credential row instead. There is also no "latest available" half here — the Dashboard
 * has no published release catalog, so this states what is installed and nothing more.
 */
function DashboardVersionPanel() {
  const { t, locale } = useTranslation();
  const { data: devices = [] } = usePairedDevicesQuery();

  const dashboard =
    devices.find((device) => device.kind === "dashboard") ?? null;
  const linkedOn = dashboard
    ? new Date(dashboard.created_at).toLocaleDateString(locale)
    : null;

  return (
    <div className="space-y-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5">
      <p className="text-sm font-semibold tracking-tight">
        {t("settings.cloud.dashboardTitle")}
      </p>
      {dashboard ? (
        <>
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
            <p className="text-muted-foreground text-xs uppercase tracking-[0.25em]">
              {t("settings.cloud.dashboardVersionLabel")}
            </p>
            <p className="mt-2 font-mono text-sm">
              {dashboard.app_version ??
                t("settings.cloud.dashboardVersionUnknown")}
              {dashboard.app_version && dashboard.version_code != null
                ? ` (${dashboard.version_code})`
                : ""}
            </p>
          </div>
          {linkedOn ? (
            <p className="text-muted-foreground text-sm">
              {t("settings.cloud.dashboardLinkedOn", { date: linkedOn })}
            </p>
          ) : null}
        </>
      ) : (
        <p className="text-muted-foreground text-sm leading-relaxed">
          {t("settings.cloud.dashboardNotLinked")}
        </p>
      )}
    </div>
  );
}

type PushStatus = Awaited<ReturnType<typeof getPushClientStatus>>;

function PushDiagnostics() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = () => {
    void getPushClientStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
  };

  useEffect(() => {
    refresh();
  }, []);

  const handleSync = async () => {
    setBusy("sync");
    try {
      await ensureNotificationsPermission();
      await ensurePushSubscription();
      refresh();
      toast.success(t("settings.push.refreshed") as string);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : (t("settings.push.syncError") as string),
      );
    } finally {
      setBusy(null);
    }
  };

  const handleLocalTest = async () => {
    setBusy("local");
    try {
      const result = await showLocalTestNotification();
      if (!result.ok) throw new Error(result.error);
      toast.success(t("settings.push.localRequested") as string);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : (t("settings.push.localError") as string),
      );
    } finally {
      setBusy(null);
    }
  };

  const handleServerTest = async () => {
    setBusy("server");
    try {
      await ensurePushSubscription();
      const result = await sendTestPush();
      if (!result.ok) throw new Error(result.error);
      toast.success(
        t("settings.push.serverSent", { count: result.sent ?? 0 }) as string,
      );
      refresh();
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : (t("settings.push.serverError") as string),
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card size="sm" className="border-white/[0.08]">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="size-5" aria-hidden />
          {t("settings.push.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <PushStatusRow
            label={t("settings.push.supported") as string}
            value={
              (status?.supported
                ? t("settings.push.yes")
                : t("settings.push.no")) as string
            }
          />
          <PushStatusRow
            label={t("settings.push.permission") as string}
            value={
              status?.permission ?? (t("settings.push.checking") as string)
            }
          />
          <PushStatusRow
            label={t("settings.push.serviceWorker") as string}
            value={
              status?.serviceWorker ?? (t("settings.push.checking") as string)
            }
          />
          <PushStatusRow
            label={t("settings.push.subscription") as string}
            value={
              (status?.hasSubscription
                ? t("settings.push.savedOnDevice")
                : t("settings.push.missing")) as string
            }
          />
          <PushStatusRow
            label={t("settings.push.endpoint") as string}
            value={status?.endpointHost ?? (t("settings.push.none") as string)}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Button
            type="button"
            variant="secondary"
            size="lg"
            className="h-11 rounded-full text-sm"
            disabled={busy !== null}
            onClick={handleSync}
          >
            {busy === "sync"
              ? t("settings.push.checkingBtn")
              : t("settings.push.checkBtn")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="h-11 rounded-full text-sm"
            disabled={busy !== null}
            onClick={handleLocalTest}
          >
            {busy === "local"
              ? t("settings.push.sendingBtn")
              : t("settings.push.localBtn")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="h-11 rounded-full text-sm"
            disabled={busy !== null}
            onClick={handleServerTest}
          >
            {busy === "server"
              ? t("settings.push.sendingBtn")
              : t("settings.push.serverBtn")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PushStatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
      <p className="text-muted-foreground text-xs uppercase tracking-[0.25em]">
        {label}
      </p>
      <p className="mt-2 break-words font-mono text-sm">{value}</p>
    </div>
  );
}

function CarRow({ car }: { car: Car }) {
  const { t } = useTranslation();
  const appPath = useAppPath();
  const qc = useQueryClient();
  const [chemistrySaving, setChemistrySaving] = useState(false);
  const generationLabel = t(
    `cars.generation.${car.model_generation}`,
  ) as string;
  const derivedChemistry = deriveAuxBatteryChemistry(car.model_generation);

  const handleChemistryChange = async (value: string | null) => {
    if (value == null) return;
    const batteryChemistry =
      value === "auto" ? null : (value as AuxBatteryChemistry);
    setChemistrySaving(true);
    const { error } = await createClient()
      .from("cars")
      .update({ battery_chemistry: batteryChemistry })
      .eq("id", car.id)
      .eq("user_id", car.user_id);
    setChemistrySaving(false);
    if (error) {
      toast.error(t("settings.auxBattery.saveError") as string);
      return;
    }
    await qc.invalidateQueries({ queryKey: queryKeys.cars });
    toast.success(t("settings.auxBattery.saved") as string);
  };

  const handleDelete = async () => {
    if (!confirm(t("settings.removeConfirm", { name: car.name }) as string))
      return;
    const res = await deleteCar(car.id);
    if (!res.ok) {
      toast.error(
        typeof res.error === "string"
          ? res.error
          : (t("settings.deleteError") as string),
      );
      return;
    }
    toast.success(t("settings.removed", { name: car.name }) as string);
  };

  return (
    <div className="border-white/[0.08] flex flex-wrap items-start justify-between gap-3 rounded-2xl border bg-white/[0.02] px-4 py-3.5">
      <div className="min-w-[16rem] flex-1">
        <p className="text-base font-semibold tracking-tight">{car.name}</p>
        <p className="text-muted-foreground text-sm">{generationLabel}</p>
        <p className="text-muted-foreground text-sm">
          {t("settings.pedestal", {
            battery: car.battery_capacity_kwh,
            power: car.default_charger_power_kw,
          })}
        </p>
        <div className="mt-3 max-w-sm space-y-1.5">
          <Label htmlFor={`battery-chemistry-${car.id}`}>
            {t("settings.auxBattery.label")}
          </Label>
          <Select
            value={car.battery_chemistry ?? "auto"}
            onValueChange={(value) => void handleChemistryChange(value)}
            disabled={chemistrySaving}
          >
            <SelectTrigger
              id={`battery-chemistry-${car.id}`}
              className="w-full"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">
                {t("settings.auxBattery.derived", {
                  chemistry: t(
                    `settings.auxBattery.options.${derivedChemistry}` as TranslationKey,
                  ) as string,
                })}
              </SelectItem>
              {auxBatteryChemistries.map((chemistry) => (
                <SelectItem key={chemistry} value={chemistry}>
                  {t(
                    `settings.auxBattery.options.${chemistry}` as TranslationKey,
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {t("settings.auxBattery.help")}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="lg"
          className="h-9 rounded-full px-4 text-xs"
          asChild
        >
          <Link href={appPath(`/cars/${car.id}/edit`)}>
            <Pencil className="mr-2 size-4" aria-hidden />
            {t("settings.edit")}
          </Link>
        </Button>
        <Button
          variant="ghost"
          size="lg"
          className="h-9 rounded-full px-4 text-xs"
          type="button"
          onClick={() => void handleDelete()}
        >
          {t("settings.remove")}
        </Button>
      </div>
    </div>
  );
}

function AboutSection() {
  const { t } = useTranslation();

  return (
    <Card size="sm" className="border-white/[0.08]">
      <CardHeader>
        <CardTitle>{t("settings.about")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-muted-foreground text-sm leading-relaxed">
          {t("settings.aboutBody")}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Button
            asChild
            variant="secondary"
            size="lg"
            className="h-11 justify-between rounded-full px-4 text-sm font-semibold"
          >
            <a
              href="https://t.me/bydyuanupbuybelarus"
              target="_blank"
              rel="noreferrer"
            >
              <span className="inline-flex items-center gap-3">
                <MessageCircle className="size-5" aria-hidden />
                {t("settings.telegram")}
              </span>
              <ExternalLink className="size-4" aria-hidden />
            </a>
          </Button>
          <Button
            asChild
            variant="secondary"
            size="lg"
            className="h-11 justify-between rounded-full px-4 text-sm font-semibold"
          >
            <a
              href="https://github.com/scroodge/EvACChargeApp"
              target="_blank"
              rel="noreferrer"
            >
              <span className="inline-flex items-center gap-3">
                <Code2 className="size-5" aria-hidden />
                {t("settings.github")}
              </span>
              <ExternalLink className="size-4" aria-hidden />
            </a>
          </Button>
        </div>
        <Separator className="bg-white/15" />
        <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
          <p className="flex items-start gap-3">
            <Scale className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{t("settings.license")}</span>
          </p>
          <p>{t("settings.copyright")}</p>
        </div>
      </CardContent>
    </Card>
  );
}
