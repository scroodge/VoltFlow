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
  MessageCircle,
  RefreshCw,
  Scale,
  ShieldCheck,
} from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { deleteCar } from "@/actions/cars";
import { sendTestPush } from "@/actions/push";
import { LocaleSwitcher } from "@/components/locale-switcher";
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
import { isMateUpdateAvailable } from "@/lib/mate-version";
import {
  currencies,
  currencyLabels,
  currencySymbols,
  isCurrency,
  isLocale,
  type Currency,
  type Locale,
} from "@/lib/i18n";
import { parseDecimalInput } from "@/lib/number-input";
import { devFetch, isDevAppRoute } from "@/lib/dev/dev-fetch";
import { useAppPath } from "@/lib/dev/dev-path";
import {
  ensureNotificationsPermission,
  ensurePushSubscription,
  getPushClientStatus,
  showLocalTestNotification,
} from "@/lib/push/client";
import { useAppPreferences } from "@/stores/use-app-preferences";
import type { Car } from "@/types/database";

export function SettingsView({ isAdmin = false }: { isAdmin?: boolean }) {
  const router = useRouter();
  const appPath = useAppPath();
  const { data: carsResult, isLoading } = useCarsQuery();
  const cars = carsResult?.cars;
  const [email, setEmail] = useState<string | null>(null);
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [bydmateCloudApiKey, setBydmateCloudApiKey] = useState("");
  const [linkCode, setLinkCode] = useState<string | null>(null);
  const [linkExpiresAt, setLinkExpiresAt] = useState<number | null>(null);
  const [linkCountdownSec, setLinkCountdownSec] = useState<number | null>(null);
  const [linkCreating, setLinkCreating] = useState(false);
  const [cloudAdvancedOpen, setCloudAdvancedOpen] = useState(false);
  const defaultPricePerKwh = useAppPreferences((s) => s.defaultPricePerKwh);
  const setDefaultPrice = useAppPreferences((s) => s.setDefaultPricePerKwh);
  const currency = useAppPreferences((s) => s.currency);
  const setCurrency = useAppPreferences((s) => s.setCurrency);
  const setLocale = useAppPreferences((s) => s.setLocale);
  const { t } = useTranslation();
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
            bydmate_cloud_api_key?: string | null;
          } | null;
        };

        setEmail(payload.email ?? null);
        setProfileUserId(payload.profile?.id ?? null);

        const preferredCurrency = payload.profile?.preferred_currency;
        if (typeof preferredCurrency === "string" && isCurrency(preferredCurrency)) {
          setCurrency(preferredCurrency);
        }

        const defaultPrice = Number(payload.profile?.default_price_per_kwh);
        if (Number.isFinite(defaultPrice) && defaultPrice >= 0) {
          setDefaultPrice(defaultPrice);
        }

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

      const { data: profile, error } = await supabase
        .from("profiles")
        .select("preferred_currency, default_price_per_kwh, bydmate_cloud_api_key")
        .eq("id", user.id)
        .single();

      if (!mounted || error) return;

      const preferredCurrency = profile?.preferred_currency;
      if (typeof preferredCurrency === "string" && isCurrency(preferredCurrency)) {
        setCurrency(preferredCurrency);
      }

      const defaultPrice = Number(profile?.default_price_per_kwh);
      if (Number.isFinite(defaultPrice) && defaultPrice >= 0) {
        setDefaultPrice(defaultPrice);
      }

      setBydmateCloudApiKey(
        typeof profile?.bydmate_cloud_api_key === "string"
          ? profile.bydmate_cloud_api_key
          : "",
      );
    });

    return () => {
      mounted = false;
    };
  }, [setCurrency, setDefaultPrice]);

  const handlePriceSave = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const numeric = parseDecimalInput(
      String(new FormData(event.currentTarget).get("pref-price") ?? ""),
    );
    if (!Number.isFinite(numeric) || numeric < 0) {
      toast.error(t("settings.tariffPositive") as string);
      return;
    }

    const previous = defaultPricePerKwh;
    setDefaultPrice(numeric);

    if (!profileUserId) {
      toast.success(t("settings.tariffSaved") as string);
      return;
    }

    void createClient()
      .from("profiles")
      .update({ default_price_per_kwh: numeric })
      .eq("id", profileUserId)
      .then(({ error }) => {
        if (error) {
          setDefaultPrice(previous);
          toast.error(error.message);
          return;
        }
        toast.success(t("settings.tariffSaved") as string);
      });
  };

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
      toast.message("Dev preview — sign out disabled");
      return;
    }
    const supabase = createClient();
    await supabase.auth.signOut();
    toast.success(t("settings.signedOut") as string);
    router.replace("/login");
    router.refresh();
  };

  const handleGenerateBydmateKey = () => {
    if (!profileUserId) {
      toast.error("Sign in before generating a BYDMate key");
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
        toast.success("BYDMate API key generated");
      });
  };

  const handleCopyBydmateKey = () => {
    if (!bydmateCloudApiKey) return;
    void navigator.clipboard
      .writeText(bydmateCloudApiKey)
      .then(() => toast.success("BYDMate API key copied"))
      .catch(() => toast.error("Could not copy API key"));
  };

  useEffect(() => {
    if (!linkExpiresAt) {
      setLinkCountdownSec(null);
      return;
    }

    const tick = () => {
      const remainingMs = linkExpiresAt - Date.now();
      if (remainingMs <= 0) {
        setLinkCountdownSec(0);
        return;
      }
      setLinkCountdownSec(Math.ceil(remainingMs / 1000));
    };

    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [linkExpiresAt]);

  const formatLinkCountdown = (totalSec: number) => {
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${String(sec).padStart(2, "0")}`;
  };

  const handleCreateBydmateLinkCode = () => {
    if (!profileUserId && !isDevAppRoute()) {
      toast.error("Sign in before linking BYDMate");
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
    <div className="flex flex-col gap-6 p-6">
      <div>
        <p className="text-muted-foreground text-xs uppercase tracking-[0.3em]">
          {t("settings.eyebrow")}
        </p>
        <h1 className="mt-2 text-balance text-4xl font-semibold tracking-tight">
          {t("settings.title")}
        </h1>
        <p className="text-muted-foreground mt-3 max-w-2xl text-lg">
          {t("settings.subtitle")}
        </p>
      </div>

      <Card className="border-white/[0.08]">
        <CardHeader>
          <CardTitle className="text-xl tracking-tight">{t("locale.label")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <LocaleSwitcher onLocaleChange={handleLocaleChange} />
          <p className="text-muted-foreground text-sm">{t("locale.helper")}</p>
        </CardContent>
      </Card>

      <Card className="border-white/[0.08]">
        <CardHeader>
          <CardTitle className="text-xl tracking-tight">{t("settings.account")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-base leading-relaxed">
          <div>
            <p className="text-muted-foreground text-sm uppercase tracking-[0.3em]">
              {t("settings.email")}
            </p>
            {email === null ? (
              <Skeleton className="mt-4 h-[22px] w-2/5 rounded-xl" />
            ) : (
              <p className="mt-4 text-lg">{email ?? t("common.unavailable")}</p>
            )}
          </div>

          <Button
            className="h-[54px] w-full rounded-full text-base font-semibold"
            variant="outline"
            type="button"
            onClick={() => void handleSignOut()}
          >
            {t("settings.signOut")}
          </Button>
        </CardContent>
      </Card>

      {isAdmin ? <PushDiagnostics /> : null}

      {isAdmin ? (
        <Card className="border-white/[0.08]">
          <CardHeader>
            <CardTitle className="flex items-center gap-3 text-xl tracking-tight">
              <ShieldCheck className="size-5 text-[var(--voltflow-green)]" aria-hidden />
              CMS базы знаний
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground text-base leading-relaxed">
              Управление статьями, вопросами, аксессуарами, запчастями и разделами
              для Telegram-базы знаний VoltFlow.
            </p>
            <Button
              asChild
              variant="secondary"
              size="lg"
              className="h-[54px] w-full justify-between rounded-full px-5 text-base font-semibold"
            >
              <Link href="/admin/knowledge">
                <span className="inline-flex items-center gap-3">
                  <ShieldCheck className="size-5" aria-hidden />
                  Открыть CMS
                </span>
                <ExternalLink className="size-4" aria-hidden />
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card className="border-white/[0.08]">
        <CardHeader>
          <CardTitle className="flex items-center gap-3 text-xl tracking-tight">
            <KeyRound className="size-5" aria-hidden />
            {t("settings.cloud.name")} 
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-muted-foreground text-base leading-relaxed">
            {t("settings.cloud.description")}
          </p>

          <div className="space-y-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5">
            <p className="text-sm font-semibold tracking-tight">{t("settings.cloud.installTitle")}</p>
            <ol className="text-muted-foreground list-decimal space-y-3 pl-5 text-sm leading-relaxed">
              {(t("settings.cloud.installSteps") as readonly string[]).map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <Button
              asChild
              variant="outline"
              size="lg"
              className="h-[48px] w-full rounded-full"
            >
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
          </div>

          <MateVersionPanel />

          {linkCode && linkCountdownSec != null && linkCountdownSec > 0 ? (
            <div className="space-y-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5">
              <p className="text-center font-mono text-5xl font-semibold tracking-[0.35em] tabular-nums">
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
                className="h-[48px] w-full rounded-full"
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
                className="h-[54px] w-full rounded-full"
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
              className="h-[54px] w-full rounded-full"
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
                  value={bydmateCloudApiKey || "No key generated yet"}
                  readOnly
                  className="h-[54px] rounded-2xl font-mono text-sm"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="lg"
                  className="h-[54px] rounded-full"
                  onClick={handleGenerateBydmateKey}
                >
                  <RefreshCw className="mr-2 size-4" aria-hidden />
                  {t("settings.cloud.generateKey")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  className="h-[54px] rounded-full"
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
        </CardContent>
      </Card>

      <Card className="border-white/[0.08]">
        <CardHeader>
          <CardTitle className="text-xl tracking-tight">{t("settings.economics")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-8">
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
                  className="h-[54px] w-full rounded-2xl text-lg"
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

            <Label htmlFor="pref-price">
              {t("settings.tariff", { currency: currencySymbols[currency] })}
            </Label>
            <Input
              key={defaultPricePerKwh}
              id="pref-price"
              name="pref-price"
              type="text"
              step="any"
              defaultValue={String(defaultPricePerKwh)}
              inputMode="decimal"
              pattern="[0-9]*[,.]?[0-9]*"
              min={0}
              className="h-[54px] rounded-2xl text-lg"
              required
            />
            <p className="text-muted-foreground text-sm">
              {t("settings.tariffHelp")}
            </p>
            <Button className="h-[52px] w-full rounded-full text-base font-semibold" type="submit">
              {t("settings.storeDefault")}
            </Button>
          </form>
          <Separator className="my-16 bg-white/15" />

          <div className="space-y-8">
            <div className="flex items-start justify-between gap-6">
              <div className="space-y-6">
                <p className="text-xs uppercase tracking-[0.38em] text-muted-foreground">
                  {t("settings.housekeeping")}
                </p>
                <p className="text-lg leading-relaxed text-muted-foreground">
                  {t("settings.housekeepingBody")}
                </p>
              </div>
              <Button asChild variant="secondary" size="lg" className="h-[54px] rounded-full">
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

      <PrivacyNote />
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
          <p className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--voltflow-cyan)]">
            <ArrowUpCircle className="size-4 shrink-0" aria-hidden />
            {t("settings.cloud.versionUpdateAvailable")}
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
      toast.success("Push status refreshed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not sync push");
    } finally {
      setBusy(null);
    }
  };

  const handleLocalTest = async () => {
    setBusy("local");
    try {
      const result = await showLocalTestNotification();
      if (!result.ok) throw new Error(result.error);
      toast.success("Local notification requested");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not show local notification");
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
      toast.success(`Server push sent to ${result.sent ?? 0} device(s)`);
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send server push");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="border-white/[0.08]">
      <CardHeader>
        <CardTitle className="flex items-center gap-3 text-xl tracking-tight">
          <Bell className="size-5" aria-hidden />
          Push diagnostics
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <PushStatusRow label="Supported" value={status?.supported ? "yes" : "no"} />
          <PushStatusRow label="Permission" value={status?.permission ?? "checking"} />
          <PushStatusRow label="Service worker" value={status?.serviceWorker ?? "checking"} />
          <PushStatusRow label="Subscription" value={status?.hasSubscription ? "saved on device" : "missing"} />
          <PushStatusRow label="Endpoint" value={status?.endpointHost ?? "none"} />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Button
            type="button"
            variant="secondary"
            size="lg"
            className="h-[54px] rounded-full"
            disabled={busy !== null}
            onClick={handleSync}
          >
            {busy === "sync" ? "Checking..." : "Check push"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="h-[54px] rounded-full"
            disabled={busy !== null}
            onClick={handleLocalTest}
          >
            {busy === "local" ? "Sending..." : "Local test"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="h-[54px] rounded-full"
            disabled={busy !== null}
            onClick={handleServerTest}
          >
            {busy === "server" ? "Sending..." : "Server test"}
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
    <div className="border-white/[0.08] flex flex-wrap items-start justify-between gap-6 rounded-3xl border bg-white/[0.02] px-6 py-6">
      <div>
        <p className="text-lg font-semibold tracking-tight">{car.name}</p>
        <p className="text-muted-foreground text-sm">{generationLabel}</p>
        <p className="text-muted-foreground text-base">
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
          className="rounded-full px-8 text-[15px]"
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
          className="rounded-full px-8 text-[15px]"
          type="button"
          onClick={() => void handleDelete()}
        >
          {t("settings.remove")}
        </Button>
      </div>
    </div>
  );
}

function PrivacyNote() {
  const { t } = useTranslation();
  const privacyItems = t("settings.privacyItems") as readonly string[];

  return (
    <div className="text-muted-foreground border-white/[0.08] mx-auto rounded-3xl border bg-white/[0.02] px-8 py-16 text-lg leading-relaxed">
      {t("settings.privacy")}
      <Separator className="my-14 bg-transparent" />
      <p className="text-muted-foreground/80 text-[13px] uppercase tracking-[0.45em]">
        {t("settings.privacyTitle")}
      </p>
      <ul className="mt-14 list-none space-y-8 text-muted-foreground/90 tracking-tight">
        {privacyItems.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function AboutSection() {
  const { t } = useTranslation();

  return (
    <Card className="border-white/[0.08]">
      <CardHeader>
        <CardTitle className="text-xl tracking-tight">{t("settings.about")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-muted-foreground text-base leading-relaxed">
          {t("settings.aboutBody")}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Button
            asChild
            variant="secondary"
            size="lg"
            className="h-[54px] justify-between rounded-full px-5 text-base font-semibold"
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
            className="h-[54px] justify-between rounded-full px-5 text-base font-semibold"
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
