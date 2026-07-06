"use client";

import Link from "next/link";
import { Bell, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  ArrowUpCircle,
  CheckCircle2,
  ChevronDown,
  Code2,
  Copy,
  ExternalLink,
  KeyRound,
  Loader2,
  MessageCircle,
  RefreshCw,
  Scale,
  ShieldCheck,
} from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { deleteCar } from "@/actions/cars";
import { sendTestPush } from "@/actions/push";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { LegalSettingsRow } from "@/components/legal/legal-document-view";
import { FreeRetentionNotice } from "@/components/premium/free-retention-notice";
import { ClusterBackgroundsSettings } from "@/components/settings/cluster-backgrounds-settings";
import { SettingsGroup, SettingsGroupDivider, SettingsPageHeader } from "@/components/settings/settings-section";
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
import { useBydmateLiveQuery } from "@/hooks/use-bydmate-live-query";
import { useCarsQuery } from "@/hooks/use-cars-query";
import { useMateReleaseQuery } from "@/hooks/use-mate-release-query";
import { useTranslation } from "@/hooks/use-translation";
import { compareMateVersions, isMateUpdateAvailable } from "@/lib/mate-version";
import { sendPasswordResetEmail } from "@/lib/auth/password-reset";
import { telegramApiUrl } from "@/lib/telegram/api-url";
import { isTelegramWebView } from "@/lib/telegram/environment";
import {
  MATE_GITHUB_RELEASES_LATEST_URL,
  summarizeReleaseNotes,
} from "@/lib/mate-release-summary";
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
import { devFetch, isDevAppRoute } from "@/lib/dev/dev-fetch";
import { useAppPath } from "@/lib/dev/dev-path";
import { mapChargingTariffLocation } from "@/lib/db-map";
import {
  PROVIDER_LABELS,
  PROVIDER_TARIFF_PRESETS,
} from "@/lib/charging-tariffs";
import {
  ensureNotificationsPermission,
  ensurePushSubscription,
  getPushClientStatus,
  showLocalTestNotification,
} from "@/lib/push/client";
import { useAppPreferences } from "@/stores/use-app-preferences";
import type {
  Car,
  ChargingProviderType,
  ChargingTariffLocationRow,
  ChargingTariffType,
} from "@/types/database";

type NotifyChannel = "web_push" | "telegram" | "both";

const notifyChannels = ["web_push", "telegram", "both"] as const;

function isNotifyChannel(value: unknown): value is NotifyChannel {
  return typeof value === "string" && notifyChannels.includes(value as NotifyChannel);
}

function TariffLocationMapPreview({ lat, lng }: { lat: number; lng: number }) {
  const { t } = useTranslation();
  const latDelta = 0.006;
  const lngDelta = 0.012;
  const params = new URLSearchParams({
    bbox: [
      lng - lngDelta,
      lat - latDelta,
      lng + lngDelta,
      lat + latDelta,
    ].join(","),
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
  const [telegramInstructionsOpen, setTelegramInstructionsOpen] = useState(false);
  const [securityBusy, setSecurityBusy] = useState(false);
  const [telegramBusy, setTelegramBusy] = useState(false);
  const [bydmateCloudApiKey, setBydmateCloudApiKey] = useState("");
  const [linkCode, setLinkCode] = useState<string | null>(null);
  const [linkExpiresAt, setLinkExpiresAt] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [linkCreating, setLinkCreating] = useState(false);
  const [cloudAdvancedOpen, setCloudAdvancedOpen] = useState(false);
  const newLocationNameInputRef = useRef<HTMLInputElement>(null);
  const homePricePerKwh = useAppPreferences((s) => s.homePricePerKwh);
  const commercialAcPricePerKwh = useAppPreferences((s) => s.commercialAcPricePerKwh);
  const fastDcPricePerKwh = useAppPreferences((s) => s.fastDcPricePerKwh);
  const setDefaultPrice = useAppPreferences((s) => s.setDefaultPricePerKwh);
  const setTariffPrices = useAppPreferences((s) => s.setTariffPrices);
  const currency = useAppPreferences((s) => s.currency);
  const setCurrency = useAppPreferences((s) => s.setCurrency);
  const setLocale = useAppPreferences((s) => s.setLocale);
  const [tariffLocations, setTariffLocations] = useState<ChargingTariffLocationRow[]>([]);
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
  const [newLocationOverridePrice, setNewLocationOverridePrice] = useState("");
  const [tariffSaveState, setTariffSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const tariffSavedResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { t } = useTranslation();

  useEffect(() => {
    return () => {
      if (tariffSavedResetRef.current) clearTimeout(tariffSavedResetRef.current);
    };
  }, []);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("voltflow:last_gps");
      if (!stored) return;
      const parsed = JSON.parse(stored) as unknown;
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        "lat" in parsed &&
        "lon" in parsed &&
        typeof (parsed as Record<string, unknown>).lat === "number" &&
        typeof (parsed as Record<string, unknown>).lon === "number"
      ) {
        setNewLocationLat(String((parsed as { lat: number; lon: number }).lat));
        setNewLocationLng(String((parsed as { lat: number; lon: number }).lon));
      }
    } catch {}
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
            default_price_per_kwh?: number;
            home_price_per_kwh?: number;
            commercial_ac_price_per_kwh?: number;
            fast_dc_price_per_kwh?: number;
            bydmate_cloud_api_key?: string | null;
            telegram_id?: number | null;
            telegram_username?: string | null;
            notify_channel?: string | null;
          } | null;
          tariffLocations?: Record<string, unknown>[];
        };

        setEmail(payload.email ?? null);
        setProfileUserId(payload.profile?.id ?? null);
        setTelegramId(
          typeof payload.profile?.telegram_id === "number" ? payload.profile.telegram_id : null,
        );
        setTelegramUsername(
          typeof payload.profile?.telegram_username === "string"
            ? payload.profile.telegram_username
            : null,
        );
        if (isNotifyChannel(payload.profile?.notify_channel)) {
          setNotifyChannel(payload.profile.notify_channel);
        }

        const preferredCurrency = payload.profile?.preferred_currency;
        if (typeof preferredCurrency === "string" && isCurrency(preferredCurrency)) {
          setCurrency(preferredCurrency);
        }

        const homePrice = Number(
          payload.profile?.home_price_per_kwh ?? payload.profile?.default_price_per_kwh,
        );
        const commercialPrice = Number(
          payload.profile?.commercial_ac_price_per_kwh ?? payload.profile?.default_price_per_kwh,
        );
        const dcPrice = Number(
          payload.profile?.fast_dc_price_per_kwh ?? payload.profile?.default_price_per_kwh,
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


        setBydmateCloudApiKey(
          typeof payload.profile?.bydmate_cloud_api_key === "string"
            ? payload.profile.bydmate_cloud_api_key
            : "",
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

      const [{ data: profile, error }, { data: locationRows }] = await Promise.all([
        supabase
        .from("profiles")
        .select("preferred_currency, default_price_per_kwh, home_price_per_kwh, commercial_ac_price_per_kwh, fast_dc_price_per_kwh, bydmate_cloud_api_key, telegram_id, telegram_username, notify_channel")
        .eq("id", user.id)
        .single(),
        supabase.from("charging_tariff_locations").select("*").eq("user_id", user.id),
      ]);

      if (!mounted || error) return;

      setTelegramId(typeof profile?.telegram_id === "number" ? profile.telegram_id : null);
      setTelegramUsername(
        typeof profile?.telegram_username === "string" ? profile.telegram_username : null,
      );
      if (isNotifyChannel(profile?.notify_channel)) {
        setNotifyChannel(profile.notify_channel);
      }

      const preferredCurrency = profile?.preferred_currency;
      if (typeof preferredCurrency === "string" && isCurrency(preferredCurrency)) {
        setCurrency(preferredCurrency);
      }

      const homePrice = Number(profile?.home_price_per_kwh ?? profile?.default_price_per_kwh);
      const commercialPrice = Number(
        profile?.commercial_ac_price_per_kwh ?? profile?.default_price_per_kwh,
      );
      const dcPrice = Number(profile?.fast_dc_price_per_kwh ?? profile?.default_price_per_kwh);
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

      setBydmateCloudApiKey(
        typeof profile?.bydmate_cloud_api_key === "string"
          ? profile.bydmate_cloud_api_key
          : "",
      );
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
    tariffSavedResetRef.current = setTimeout(() => setTariffSaveState("idle"), 2_000);
  };

  const handlePriceSave = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (tariffSaveState === "saving") return;
    const form = new FormData(event.currentTarget);
    const homeNumeric = parseDecimalInput(String(form.get("pref-price-home") ?? ""));
    const acNumeric = parseDecimalInput(String(form.get("pref-price-ac") ?? ""));
    const dcNumeric = parseDecimalInput(String(form.get("pref-price-dc") ?? ""));
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
      error: (err: unknown) => (err instanceof Error ? err.message : String(err)),
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

  const applyProviderPreset = (provider: ChargingProviderType) => {
    if (provider === "custom") return;
    const preset = PROVIDER_TARIFF_PRESETS[provider];
    if (!preset) return;
    setTariffPrices({
      homePricePerKwh: preset.home,
      commercialAcPricePerKwh: preset.commercial_ac,
      fastDcPricePerKwh: preset.fast_dc,
    });
    setDefaultPrice(preset.home);
    toast.info(t("settings.locationTariffs.presetAppliedHint") as string);
  };

  const handleUseCurrentGps = () => {
    if (!navigator.geolocation) {
      toast.error(t("settings.locationTariffs.geolocationUnavailable") as string);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;
        setNewLocationLat(String(lat));
        setNewLocationLng(String(lon));
        try { localStorage.setItem("voltflow:last_gps", JSON.stringify({ lat, lon })); } catch {}
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
        price_per_kwh_override:
          Number.isFinite(override) && override > 0 ? override : null,
      })
      .select("*")
      .single()
      .then(({ data, error }) => {
        if (error || !data) {
          toast.error(error?.message ?? (t("settings.toasts.saveLocationError") as string));
          return;
        }
        const mapped = mapChargingTariffLocation(data as Record<string, unknown>);
        setTariffLocations((prev) =>
          [mapped, ...prev.filter((item) => item.id !== mapped.id)],
        );
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
    Number.isFinite(parsedNewLocationLat) && Number.isFinite(parsedNewLocationLng);
  const tariffMapLat = hasNewLocationCoords
    ? parsedNewLocationLat
    : tariffLocations[0]?.lat ?? 53.9023;
  const tariffMapLng = hasNewLocationCoords
    ? parsedNewLocationLng
    : tariffLocations[0]?.lng ?? 27.5619;

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

  const handleSignOut = async () => {
    if (isDevAppRoute()) {
      toast.message(t("settings.toasts.devSignOutDisabled") as string);
      return;
    }
    const returnPath = isTelegramWebView() ? "/telegram" : "/login";
    const supabase = createClient();
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
    const webApp = typeof window !== "undefined" ? window.Telegram?.WebApp : undefined;
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
      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; telegram_id?: number; error?: string }
        | null;
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error ?? "link_failed");
      }
      setTelegramId(payload.telegram_id ?? webApp?.initDataUnsafe?.user?.id ?? null);
      setTelegramUsername(webApp?.initDataUnsafe?.user?.username ?? null);
      setTelegramInstructionsOpen(false);
      toast.success(t("settings.telegramConnect.linked") as string);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(t("settings.telegramConnect.linkFailed")));
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

  const handleGenerateBydmateKey = () => {
    if (!profileUserId) {
      toast.error(t("settings.toasts.signInForKey") as string);
      return;
    }

    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const key = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

    void createClient()
      .from("profiles")
      .update({ bydmate_cloud_api_key: key })
      .eq("id", profileUserId)
      .then(({ error }) => {
        if (error) {
          toast.error(error.message);
          return;
        }
        setBydmateCloudApiKey(key);
        toast.success(t("settings.toasts.keyGenerated") as string);
      });
  };

  const handleCopyBydmateKey = () => {
    if (!bydmateCloudApiKey) return;
    void navigator.clipboard
      .writeText(bydmateCloudApiKey)
      .then(() => toast.success(t("settings.toasts.keyCopied") as string))
      .catch(() => toast.error(t("settings.toasts.copyKeyError") as string));
  };

  useEffect(() => {
    if (!linkExpiresAt) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [linkExpiresAt]);

  const linkCountdownSec = linkExpiresAt
    ? Math.max(0, Math.ceil((linkExpiresAt - nowMs) / 1000))
    : null;

  const formatLinkCountdown = (totalSec: number) => {
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${String(sec).padStart(2, "0")}`;
  };

  const handleCreateBydmateLinkCode = () => {
    if (!profileUserId && !isDevAppRoute()) {
      toast.error(t("settings.toasts.signInForLink") as string);
      return;
    }

    setLinkCreating(true);
    const request = isDevAppRoute()
      ? devFetch("/api/bydmate/link-code", { method: "POST" })
      : fetch("/api/bydmate/link-code", { method: "POST", credentials: "include" });

    void request
      .then(async (response) => {
        const payload = (await response.json()) as {
          ok?: boolean;
          code?: string;
          expires_at?: string;
          error?: string;
        };
        if (!response.ok || !payload.ok || !payload.code || !payload.expires_at) {
          throw new Error(payload.error ?? String(t("settings.cloud.linkCodeFailed")));
        }
        setLinkCode(payload.code);
        setNowMs(Date.now());
        setLinkExpiresAt(new Date(payload.expires_at).getTime());
      })
      .catch((error: unknown) => {
        const message =
          error instanceof Error ? error.message : String(t("settings.cloud.linkCodeFailed"));
        toast.error(message);
        setLinkCode(null);
        setLinkExpiresAt(null);
      })
      .finally(() => setLinkCreating(false));
  };

  return (
    <div className="flex flex-col gap-3 px-4 pb-5 pt-3">
      <SettingsPageHeader
        eyebrow={String(t("settings.eyebrow"))}
        title={String(t("settings.title"))}
        subtitle={String(t("settings.subtitle"))}
      />

      <Card size="sm" className="border-white/[0.08]">
        <CardHeader>
          <CardTitle>{t("locale.label")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <LocaleSwitcher onLocaleChange={handleLocaleChange} />
          <p className="text-muted-foreground text-sm">{t("locale.helper")}</p>
        </CardContent>
      </Card>

      <Card size="sm" className="border-white/[0.08]">
        <CardHeader>
          <CardTitle>{t("settings.account")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-relaxed">
          <div>
            <p className="text-muted-foreground text-xs uppercase tracking-[0.24em]">
              {t("settings.email")}
            </p>
            {email === null ? (
              <Skeleton className="mt-2 h-5 w-2/5 rounded-xl" />
            ) : (
              <p className="mt-2 text-sm">{email ?? t("common.unavailable")}</p>
            )}
          </div>

          <Button
            className="h-11 w-full rounded-full text-sm font-semibold"
            variant="outline"
            type="button"
            onClick={() => void handleSignOut()}
          >
            {t("settings.signOut")}
          </Button>
        </CardContent>
      </Card>

      <Card size="sm" className="border-white/[0.08]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-5" aria-hidden />
            {t("settings.security.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-muted-foreground text-sm leading-relaxed">
            {t("settings.security.body")}
          </p>
          <Button
            type="button"
            variant="secondary"
            size="lg"
            className="h-11 w-full rounded-full text-sm font-semibold"
            disabled={securityBusy || !email}
            onClick={() => void handleAddPassword()}
          >
            {securityBusy ? t("settings.security.sending") : t("settings.security.addPassword")}
          </Button>
        </CardContent>
      </Card>

      <Card size="sm" className="border-white/[0.08]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageCircle className="size-5" aria-hidden />
            {t("settings.telegramConnect.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
            <p className="text-muted-foreground text-xs uppercase tracking-[0.25em]">
              {t("settings.telegramConnect.status")}
            </p>
            <p className="mt-2 text-sm font-medium">
              {telegramId
                ? t("settings.telegramConnect.connected", {
                    username: telegramUsername ? `@${telegramUsername}` : String(telegramId),
                  })
                : t("settings.telegramConnect.notConnected")}
            </p>
          </div>

          <Button
            type="button"
            variant={telegramId ? "outline" : "secondary"}
            size="lg"
            className="h-11 w-full rounded-full text-sm font-semibold"
            disabled={telegramBusy}
            onClick={() => void handleConnectTelegram()}
          >
            {telegramBusy
              ? t("settings.telegramConnect.connecting")
              : telegramId
                ? t("settings.telegramConnect.reconnect")
                : t("settings.telegramConnect.connect")}
          </Button>

          {telegramInstructionsOpen ? (
            <div className="space-y-3 rounded-2xl border border-[var(--voltflow-cyan)]/25 bg-[var(--voltflow-cyan)]/10 p-4">
              <p className="text-sm font-semibold">
                {t("settings.telegramConnect.instructionsTitle")}
              </p>
              <ol className="text-muted-foreground list-decimal space-y-2 pl-5 text-sm leading-relaxed">
                {(t("settings.telegramConnect.instructions") as readonly string[]).map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <Button
                asChild
                variant="outline"
                size="lg"
                className="h-11 w-full justify-between rounded-full px-4 text-sm font-semibold"
              >
                <a href="https://t.me/Voltflowscr_bot" target="_blank" rel="noreferrer">
                  <span>{t("settings.telegramConnect.openBot")}</span>
                  <ExternalLink className="size-4" aria-hidden />
                </a>
              </Button>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="notify-channel">
              {t("settings.telegramConnect.channelLabel")}
            </Label>
            <Select
              value={notifyChannel}
              onValueChange={handleNotifyChannelChange}
              items={notifyChannels.map((channel) => ({
                value: channel,
                label: t(`settings.telegramConnect.channels.${channel}` as TranslationKey) as string,
              }))}
            >
              <SelectTrigger id="notify-channel" className="h-11 w-full rounded-2xl text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {notifyChannels.map((channel) => (
                  <SelectItem key={channel} value={channel}>
                    {t(`settings.telegramConnect.channels.${channel}` as TranslationKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-sm">
              {t("settings.telegramConnect.channelHelp")}
            </p>
          </div>
        </CardContent>
      </Card>

      <FreeRetentionNotice />

      {isAdmin ? <PushDiagnostics /> : null}

      {isAdmin ? (
        <Card size="sm" className="border-white/[0.08]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="size-5 text-[var(--voltflow-green)]" aria-hidden />
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
              <ShieldCheck className="size-5 text-[var(--voltflow-cyan)]" aria-hidden />
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

      <Card size="sm" className="border-white/[0.08]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-5" aria-hidden />
            {t("settings.cloud.name")} 
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground text-sm leading-relaxed">
            {t("settings.cloud.description")}
          </p>

          <details className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4">
            <summary className="cursor-pointer list-none text-sm font-semibold tracking-tight">
              {t("settings.cloud.installTitle")}
            </summary>
            <ol className="text-muted-foreground mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed">
              {(t("settings.cloud.installSteps") as readonly string[]).map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <Button asChild variant="outline" className="mt-3 h-11 w-full rounded-full text-sm">
              <a
                href="https://github.com/scroodge/BYDMate-own/releases/latest"
                target="_blank"
                rel="noreferrer"
              >
                <span className="inline-flex items-center gap-2">
                  {t("settings.cloud.downloadApk")}
                  <ExternalLink className="size-4" aria-hidden />
                </span>
              </a>
            </Button>
          </details>

          <MateVersionPanel />

          {linkCode && linkCountdownSec != null && linkCountdownSec > 0 ? (
            <div className="space-y-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4">
              <p className="text-center font-mono text-4xl font-semibold tracking-[0.32em] tabular-nums">
                {linkCode.slice(0, 3)} {linkCode.slice(3)}
              </p>
              <p className="text-muted-foreground text-center text-sm">
                {t("settings.cloud.linkCodeHint")}
              </p>
              <p className="text-center text-sm text-[var(--voltflow-green)]">
                {t("settings.cloud.linkCodeExpires", {
                  time: formatLinkCountdown(linkCountdownSec),
                })}
              </p>
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="h-11 w-full rounded-full text-sm"
                onClick={handleCreateBydmateLinkCode}
                disabled={linkCreating}
              >
                <RefreshCw className="mr-2 size-4" aria-hidden />
                {t("settings.cloud.linkBydmate")}
              </Button>
            </div>
          ) : linkCode && linkCountdownSec === 0 ? (
            <div className="space-y-3">
              <p className="text-muted-foreground text-sm">{t("settings.cloud.linkCodeExpired")}</p>
              <Button
                type="button"
                variant="secondary"
                size="lg"
                className="h-11 w-full rounded-full text-sm"
                onClick={handleCreateBydmateLinkCode}
                disabled={linkCreating}
              >
                <RefreshCw className="mr-2 size-4" aria-hidden />
                {linkCreating
                  ? t("settings.cloud.linkCodeCreating")
                  : t("settings.cloud.linkBydmate")}
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="secondary"
              size="lg"
              className="h-11 w-full rounded-full text-sm"
              onClick={handleCreateBydmateLinkCode}
              disabled={linkCreating}
            >
              <RefreshCw className="mr-2 size-4" aria-hidden />
              {linkCreating
                ? t("settings.cloud.linkCodeCreating")
                : t("settings.cloud.linkBydmate")}
            </Button>
          )}

          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 py-1 text-left text-sm font-medium"
            aria-expanded={cloudAdvancedOpen}
            onClick={() => setCloudAdvancedOpen((open) => !open)}
          >
            {t("settings.cloud.advanced")}
            <ChevronDown
              className={`size-4 shrink-0 transition-transform ${cloudAdvancedOpen ? "rotate-180" : ""}`}
              aria-hidden
            />
          </button>

          {cloudAdvancedOpen ? (
            <div className="space-y-4 border-t border-white/[0.08] pt-4">
              <div className="space-y-2">
                <Label htmlFor="bydmate-api-key">{t("settings.cloud.apiKey")}</Label>
                <Input
                  id="bydmate-api-key"
                  value={bydmateCloudApiKey || (t("settings.noKeyYet") as string)}
                  readOnly
                  className="h-11 rounded-2xl font-mono text-sm"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="lg"
                  className="h-11 rounded-full text-sm"
                  onClick={handleGenerateBydmateKey}
                >
                  <RefreshCw className="mr-2 size-4" aria-hidden />
                  {t("settings.cloud.generateKey")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  className="h-11 rounded-full text-sm"
                  disabled={!bydmateCloudApiKey}
                  onClick={handleCopyBydmateKey}
                >
                  <Copy className="mr-2 size-4" aria-hidden />
                  {t("settings.cloud.copyKey")}
                </Button>
              </div>
              <p className="text-muted-foreground text-sm">
                {t("settings.cloud.endpointURL")}{" "}
                <span className="font-mono">https://volt-flow-beige.vercel.app/api/bydmate/telemetry</span>
              </p>
            </div>
          ) : null}

          <ClusterBackgroundsSettings />
        </CardContent>
      </Card>

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
                onValueChange={handleCurrencyChange}
                items={currencies.map((item) => ({
                  value: item,
                  label: currencyLabels[item],
                }))}
              >
                <SelectTrigger
                  id="pref-currency"
                  className="h-11 w-full rounded-2xl text-sm"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {currencies.map((item) => (
                    <SelectItem key={item} value={item}>
                      {currencyLabels[item]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-sm">
                {t("settings.currencyHelp")}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="provider-preset">{t("settings.locationTariffs.providerPreset") as string}</Label>
              <Select
                value="custom"
                onValueChange={(value) => applyProviderPreset(value as ChargingProviderType)}
                items={[
                  { value: "custom", label: t("settings.locationTariffs.manualValues") as string },
                  { value: "home", label: PROVIDER_LABELS.home },
                  { value: "malanka", label: PROVIDER_LABELS.malanka },
                  { value: "evika", label: PROVIDER_LABELS.evika },
                  { value: "forevo", label: PROVIDER_LABELS.forevo },
                  { value: "zaryadka", label: PROVIDER_LABELS.zaryadka },
                  { value: "batterfly", label: PROVIDER_LABELS.batterfly },
                ]}
              >
                <SelectTrigger id="provider-preset" className="h-11 w-full rounded-2xl text-sm">
                  <SelectValue placeholder={t("settings.locationTariffs.applyProviderPreset") as string} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="custom">{t("settings.locationTariffs.manualValues") as string}</SelectItem>
                  <SelectItem value="home">{PROVIDER_LABELS.home}</SelectItem>
                  <SelectItem value="malanka">{PROVIDER_LABELS.malanka}</SelectItem>
                  <SelectItem value="evika">{PROVIDER_LABELS.evika}</SelectItem>
                  <SelectItem value="forevo">{PROVIDER_LABELS.forevo}</SelectItem>
                  <SelectItem value="zaryadka">{PROVIDER_LABELS.zaryadka}</SelectItem>
                  <SelectItem value="batterfly">{PROVIDER_LABELS.batterfly}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pref-price-home">
                {t("settings.locationTariffs.homeTariff", { currency: currencySymbols[currency] })}
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
                {t("settings.locationTariffs.acTariff", { currency: currencySymbols[currency] })}
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
                {t("settings.locationTariffs.dcTariff", { currency: currencySymbols[currency] })}
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
          <div className="space-y-4 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
            <p className="text-sm font-semibold tracking-tight">
              {t("settings.locationTariffs.title") as string}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Input
                  ref={newLocationNameInputRef}
                  placeholder={t("settings.locationTariffs.namePlaceholder") as string}
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
                onClick={() => {
                    const next = !newLocationAutoGps;
                    setNewLocationAutoGps(next);
                    if (next && navigator.geolocation) {
                      navigator.geolocation.getCurrentPosition(
                        (position) => {
                          const lat = position.coords.latitude;
                          const lon = position.coords.longitude;
                          setNewLocationLat(String(lat));
                          setNewLocationLng(String(lon));
                          try { localStorage.setItem("voltflow:last_gps", JSON.stringify({ lat, lon })); } catch {}
                        },
                        () => {},
                        { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
                      );
                    }
                  }}
              >
                {newLocationAutoGps
                  ? (t("settings.locationTariffs.autoGpsOn") as string)
                  : (t("settings.locationTariffs.autoGpsOff") as string)}
              </Button>
              <Input
                placeholder={t("settings.locationTariffs.radiusPlaceholder") as string}
                value={newLocationRadius}
                onChange={(event) => setNewLocationRadius(event.target.value)}
                className="h-11 rounded-2xl text-sm"
              />
              <Select
                value={newLocationTariffType}
                onValueChange={(value) =>
                  setNewLocationTariffType(value as ChargingTariffType)
                }
                items={(["home", "commercial_ac", "fast_dc"] as const).map((value) => ({
                  value,
                  label: t(`charging.tariff.types.${value}` as TranslationKey),
                }))}
              >
                <SelectTrigger className="h-11 rounded-2xl text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["home", "commercial_ac", "fast_dc"] as const).map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(`charging.tariff.types.${value}` as TranslationKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={newLocationProviderType}
                onValueChange={(value) =>
                  setNewLocationProviderType(value as ChargingProviderType)
                }
                items={(
                  ["custom", "home", "malanka", "evika", "forevo", "zaryadka", "batterfly"] as const
                ).map((value) => ({
                  value,
                  label: t(`charging.tariff.providers.${value}` as TranslationKey),
                }))}
              >
                <SelectTrigger className="h-11 rounded-2xl text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["custom", "home", "malanka", "evika", "forevo", "zaryadka", "batterfly"] as const).map(
                    (value) => (
                      <SelectItem key={value} value={value}>
                        {t(`charging.tariff.providers.${value}` as TranslationKey)}
                      </SelectItem>
                    ),
                  )}
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
              placeholder={t("settings.locationTariffs.optionalPrice", {
                currency: currencySymbols[currency],
              }) as string}
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
                        {location.provider_type} · {location.tariff_type} · {location.radius_m} m · {location.lat.toFixed(5)},{" "}
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
          <Separator className="my-6 bg-white/15" />

          <div className="space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-3">
                <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
                  {t("settings.housekeeping")}
                </p>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {t("settings.housekeepingBody")}
                </p>
              </div>
              <Button asChild variant="secondary" className="h-10 rounded-full text-sm">
                <Link href={appPath("/cars/new")}>{t("settings.addEv")}</Link>
              </Button>
            </div>
            <div className="space-y-5">
              {isLoading &&
                Array.from({ length: 2 }).map((_, index) => (
                  <Skeleton key={index} className="h-[120px] w-full rounded-3xl" />
                ))}
              {!isLoading &&
                cars?.map((car) => (
                  <CarRow key={car.id} car={car} />
                ))}
              {!isLoading && !(cars ?? []).length ? (
                <p className="text-muted-foreground text-base leading-relaxed">
                  {t("settings.noRides")}
                </p>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>

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
      <AboutSection />
    </div>
  );
}

/**
 * VoltFlow Mate version indicator. Shows the build currently running on the car
 * (latest live snapshot `mate_version`) next to the latest published release, and
 * whether an update is available. Lives inside the VoltFlow Mate settings card.
 */
function MateVersionPanel() {
  const { t } = useTranslation();
  const { data: bydmateLive = [] } = useBydmateLiveQuery();
  const { data: release } = useMateReleaseQuery();

  // Snapshots come back newest-first; take the most recent one that reports a version.
  const installedVersion =
    bydmateLive.find((snapshot) => snapshot.mate_version)?.mate_version ?? null;
  const latestVersion = release?.version ?? null;
  const updateAvailable = isMateUpdateAvailable(installedVersion, latestVersion);
  const installedNewerThanLatest =
    !!installedVersion &&
    !!latestVersion &&
    compareMateVersions(installedVersion, latestVersion) > 0;
  const releaseSummary =
    summarizeReleaseNotes(release?.release_notes) ??
    (updateAvailable ? t("settings.cloud.versionReleaseSummaryFallback") : null);
  const releaseUrl = release?.apk_url ?? MATE_GITHUB_RELEASES_LATEST_URL;

  return (
    <div className="space-y-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5">
      <p className="text-sm font-semibold tracking-tight">
        {t("settings.cloud.versionTitle")}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
          <p className="text-muted-foreground text-xs uppercase tracking-[0.25em]">
            {t("settings.cloud.versionInstalled")}
          </p>
          <p className="mt-2 font-mono text-sm">
            {installedVersion ?? t("settings.cloud.versionUnknown")}
          </p>
        </div>
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
          <p className="text-muted-foreground text-xs uppercase tracking-[0.25em]">
            {t("settings.cloud.versionLatest")}
          </p>
          <p className="mt-2 font-mono text-sm">
            {latestVersion ?? t("common.unavailable")}
          </p>
        </div>
      </div>
      {installedVersion ? (
        updateAvailable ? (
          <div className="space-y-2">
            <p className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--voltflow-cyan)]">
              <ArrowUpCircle className="size-4 shrink-0" aria-hidden />
              {t("settings.cloud.versionUpdateAvailable")}
            </p>
            {releaseSummary ? (
              <p className="text-muted-foreground text-sm leading-relaxed">{releaseSummary}</p>
            ) : null}
            <a
              href={releaseUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--voltflow-cyan)] underline-offset-2 hover:underline"
            >
              {t("settings.cloud.versionViewOnGitHub")}
              <ExternalLink className="size-4 shrink-0" aria-hidden />
            </a>
          </div>
        ) : installedNewerThanLatest ? (
          <p className="inline-flex items-center gap-2 text-sm font-semibold text-amber-300">
            <RefreshCw className="size-4 shrink-0" aria-hidden />
            {t("settings.cloud.versionCatalogLag")}
          </p>
        ) : (
          <p className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--voltflow-green)]">
            <CheckCircle2 className="size-4 shrink-0" aria-hidden />
            {t("settings.cloud.versionUpToDate")}
          </p>
        )
      ) : null}
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
      toast.error(err instanceof Error ? err.message : (t("settings.push.syncError") as string));
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
        err instanceof Error ? err.message : (t("settings.push.localError") as string),
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
      toast.success(t("settings.push.serverSent", { count: result.sent ?? 0 }) as string);
      refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : (t("settings.push.serverError") as string),
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
            value={(status?.supported ? t("settings.push.yes") : t("settings.push.no")) as string}
          />
          <PushStatusRow
            label={t("settings.push.permission") as string}
            value={status?.permission ?? (t("settings.push.checking") as string)}
          />
          <PushStatusRow
            label={t("settings.push.serviceWorker") as string}
            value={status?.serviceWorker ?? (t("settings.push.checking") as string)}
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
            {busy === "sync" ? t("settings.push.checkingBtn") : t("settings.push.checkBtn")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="h-11 rounded-full text-sm"
            disabled={busy !== null}
            onClick={handleLocalTest}
          >
            {busy === "local" ? t("settings.push.sendingBtn") : t("settings.push.localBtn")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="h-11 rounded-full text-sm"
            disabled={busy !== null}
            onClick={handleServerTest}
          >
            {busy === "server" ? t("settings.push.sendingBtn") : t("settings.push.serverBtn")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PushStatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
      <p className="text-muted-foreground text-xs uppercase tracking-[0.25em]">{label}</p>
      <p className="mt-2 break-words font-mono text-sm">{value}</p>
    </div>
  );
}

function CarRow({ car }: { car: Car }) {
  const { t } = useTranslation();
  const appPath = useAppPath();
  const generationLabel = t(`cars.generation.${car.model_generation}`) as string;

  const handleDelete = async () => {
    if (!confirm(t("settings.removeConfirm", { name: car.name }) as string)) return;
    const res = await deleteCar(car.id);
    if (!res.ok) {
      toast.error(
        typeof res.error === "string" ? res.error : (t("settings.deleteError") as string),
      );
      return;
    }
    toast.success(t("settings.removed", { name: car.name }) as string);
  };

  return (
    <div className="border-white/[0.08] flex flex-wrap items-start justify-between gap-3 rounded-2xl border bg-white/[0.02] px-4 py-3.5">
      <div>
        <p className="text-base font-semibold tracking-tight">{car.name}</p>
        <p className="text-muted-foreground text-sm">{generationLabel}</p>
        <p className="text-muted-foreground text-sm">
          {t("settings.pedestal", {
            battery: car.battery_capacity_kwh,
            power: car.default_charger_power_kw,
          })}
        </p>
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
