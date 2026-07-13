"use client";

import { BookOpen, Gauge, LocateFixed, Send, Smartphone, Zap } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AppIcon } from "@/components/brand/AppIcon";
import { BrandBadge } from "@/components/brand/BrandBadge";
import { LogoFull } from "@/components/brand/LogoFull";
import { BatteryRing } from "@/components/charging/BatteryRing";
import { ChargingStatsGrid } from "@/components/charging/ChargingStatsGrid";
import { LegalFooterLinks } from "@/components/legal/legal-document-view";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import { StartTrackingButton } from "@/components/pwa/start-tracking-button";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/hooks/use-translation";
import { createClient } from "@/lib/supabase/client";
import { TELEGRAM_MINIAPP_URL } from "@/lib/support";

type IpLocation = {
  city?: string;
  region?: string;
  country_code?: string;
  country_name?: string;
  timezone?: string;
};

export default function LandingPage() {
  const { locale, t } = useTranslation();
  const [location, setLocation] = useState<IpLocation | null>(null);
  const [locationStatus, setLocationStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const router = useRouter();
  const year = new Date().getFullYear();

  // Already-signed-in visitors shouldn't sit on the marketing page. This also
  // rescues the self-hosted OAuth case where GoTrue drops the user on `/?code=`
  // instead of /auth/callback: the browser client exchanges the code on mount,
  // fires SIGNED_IN, and we forward into the app (the onboarding gate takes over).
  useEffect(() => {
    const supabase = createClient();
    let active = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (active && data.session) router.replace("/dashboard");
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) router.replace("/dashboard");
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [router]);

  useEffect(() => {
    const controller = new AbortController();

    async function detectLocation() {
      try {
        const response = await fetch("https://ipapi.co/json/", {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Location lookup failed");
        const data = (await response.json()) as IpLocation;
        setLocation(data);
        setLocationStatus("ready");
      } catch {
        if (controller.signal.aborted) return;
        setLocationStatus("error");
      }
    }

    void detectLocation();

    return () => controller.abort();
  }, []);

  const highlights = [
    {
      icon: Zap,
      title: t("landing.highlightRealtimeTitle") as string,
      body: t("landing.highlightRealtimeBody") as string,
    },
    {
      icon: Smartphone,
      title: t("landing.highlightMobileTitle") as string,
      body: t("landing.highlightMobileBody") as string,
    },
  ];

  const localizedCountry =
    location?.country_code && typeof Intl.DisplayNames !== "undefined"
      ? new Intl.DisplayNames([locale], { type: "region" }).of(
          location.country_code,
        )
      : location?.country_name;
  const locationParts = [location?.city, location?.region, localizedCountry].filter(
    Boolean,
  );
  const locationLabel =
    locationStatus === "loading"
      ? (t("landing.geoDetecting") as string)
      : locationStatus === "ready" && locationParts.length > 0
        ? locationParts.join(", ")
        : (t("landing.geoUnavailable") as string);

  return (
    <main className="relative isolate min-h-dvh overflow-x-clip bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_-10%,rgba(0,209,255,0.28),transparent_34rem),radial-gradient(circle_at_10%_20%,rgba(0,230,118,0.18),transparent_24rem),linear-gradient(180deg,rgba(18,21,28,0)_0%,#12151C_88%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px voltflow-gradient" />

      <div className="mobile-page relative !h-auto min-h-dvh">
        <section className="relative flex min-h-[calc(100dvh-4rem)] w-full flex-col px-5 pb-8 pt-[calc(env(safe-area-inset-top)+1.25rem)]">
          <header className="flex items-center justify-between gap-3">
            <LogoFull />
            <LocaleSwitcher className="shrink-0" />
          </header>

          <div className="mt-10 space-y-5">
            <BrandBadge>{t("landing.badge")}</BrandBadge>
            <h1 className="font-heading text-6xl font-bold leading-[0.95] tracking-normal text-balance">
              VoltFlow
            </h1>
            <p className="voltflow-text-gradient font-heading text-2xl font-bold leading-tight tracking-normal">
              {t("landing.brandLine")}
            </p>
            <p className="max-w-[21rem] text-lg leading-7 text-muted-foreground">
              {t("landing.brandDescription")}
            </p>
          </div>

          <div className="mt-5 voltflow-card p-4">
            <div className="flex gap-3">
              <div className="grid size-10 shrink-0 place-items-center rounded-2xl border border-border bg-white/[0.04] text-[var(--voltflow-green)]">
                <LocateFixed className="size-5" aria-hidden />
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  {t("landing.geoTitle")}
                </p>
                <p className="mt-1 font-heading text-base font-bold">
                  {locationLabel}
                </p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {locationStatus === "ready" && location?.timezone
                    ? t("landing.geoTimezone", { timezone: location.timezone })
                    : t("landing.geoPrivacy")}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-8 space-y-3">
            <InstallPrompt />
            <div className="flex gap-3">
              <StartTrackingButton className="h-12 flex-1 rounded-full border border-border bg-white/[0.03] font-heading text-sm font-bold" />
              <Button
                size="lg"
                variant="outline"
                className="h-12 rounded-full border-border bg-white/[0.03] px-5"
                asChild
              >
                <Link
                  href="/dashboard"
                  aria-label={t("landing.dashboardAria") as string}
                >
                  <Gauge className="size-5" aria-hidden />
                </Link>
              </Button>
            </div>
          </div>

          <div className="mt-4 voltflow-card p-4">
            <div className="flex gap-3">
              <div className="grid size-10 shrink-0 place-items-center rounded-2xl border border-border bg-white/[0.04] text-[var(--voltflow-cyan)]">
                <Send className="size-5" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-heading text-base font-bold">
                  {t("landing.telegramTitle")}
                </p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {t("landing.telegramBody")}
                </p>
                <Button
                  size="lg"
                  variant="outline"
                  className="mt-3 h-11 w-full rounded-full border-border bg-white/[0.03] font-heading text-sm font-bold"
                  asChild
                >
                  <a
                    href={TELEGRAM_MINIAPP_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Send className="size-4" aria-hidden />
                    {t("landing.telegramAction")}
                  </a>
                </Button>
              </div>
            </div>
          </div>

          <div className="mt-4 voltflow-card p-4">
            <div className="flex gap-3">
              <div className="grid size-10 shrink-0 place-items-center rounded-2xl border border-border bg-white/[0.04] text-[var(--voltflow-green)]">
                <BookOpen className="size-5" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-heading text-base font-bold">
                  {t("landing.knowledgeTitle")}
                </p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {t("landing.knowledgeBody")}
                </p>
                <Button
                  size="lg"
                  variant="outline"
                  className="mt-3 h-11 w-full rounded-full border-border bg-white/[0.03] font-heading text-sm font-bold"
                  asChild
                >
                  <Link href="/knowledge">
                    <BookOpen className="size-4" aria-hidden />
                    {t("landing.knowledgeAction")}
                  </Link>
                </Button>
              </div>
            </div>
          </div>

          <div className="mt-8 voltflow-card overflow-hidden p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  {t("landing.liveCockpit")}
                </p>
                <p className="mt-1 font-heading text-xl font-bold">
                  {t("landing.demoCar")}
                </p>
              </div>
              <span className="rounded-full border border-border px-3 py-1 text-xs font-bold uppercase tracking-[0.16em] text-[var(--voltflow-green)]">
                {t("landing.statusCharging")}
              </span>
            </div>

            <BatteryRing
              percent={68}
              status={t("landing.statusCharging") as string}
              charging
              className="my-2 max-w-[230px]"
            />

            <ChargingStatsGrid
              stats={[
                {
                  label: t("landing.statKwh") as string,
                  value: t("landing.demoKwhValue") as string,
                  accent: "green",
                },
                {
                  label: t("landing.statRemaining") as string,
                  value: t("landing.demoRemainingValue") as string,
                  accent: "cyan",
                },
                {
                  label: t("landing.statPower") as string,
                  value: t("landing.demoPowerValue") as string,
                  accent: "blue",
                },
                {
                  label: t("landing.statCost") as string,
                  value: t("landing.demoCostValue") as string,
                },
              ]}
            />
          </div>
        </section>

        <section
          id="highlights"
          className="relative grid w-full gap-3 px-5 pb-[calc(env(safe-area-inset-bottom)+2rem)]"
        >
          <div className="mb-2 flex items-center gap-3">
            <AppIcon className="size-9 shrink-0" />
            <p className="font-heading text-xl font-bold">
              {t("landing.highlightsTitle")}
            </p>
          </div>
          {highlights.map(({ icon: Icon, title, body }) => (
            <article key={title} className="voltflow-card p-4">
              <div className="flex gap-3">
                <div className="grid size-10 shrink-0 place-items-center rounded-2xl border border-border bg-white/[0.04] text-[var(--voltflow-cyan)]">
                  <Icon className="size-5" aria-hidden />
                </div>
                <div>
                  <h2 className="font-heading text-base font-bold">{title}</h2>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    {body}
                  </p>
                </div>
              </div>
            </article>
          ))}
          <article className="voltflow-card p-4">
            <div className="flex gap-3">
              <div className="grid size-10 shrink-0 place-items-center rounded-2xl border border-border bg-white/[0.04] text-[var(--voltflow-cyan)]">
                <Send className="size-5" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="font-heading text-base font-bold">
                  {t("landing.telegramTitle")}
                </h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {t("landing.telegramBody")}
                </p>
                <Button
                  size="lg"
                  variant="outline"
                  className="mt-3 h-11 w-full rounded-full border-border bg-white/[0.03] font-heading text-sm font-bold"
                  asChild
                >
                  <a
                    href={TELEGRAM_MINIAPP_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Send className="size-4" aria-hidden />
                    {t("landing.telegramAction")}
                  </a>
                </Button>
              </div>
            </div>
          </article>
          <footer className="pt-5 text-center text-xs leading-6 text-muted-foreground">
            <LegalFooterLinks className="mb-3" />
            <p>{t("landing.copyright", { year })}</p>
            <p>{t("landing.rights")}</p>
          </footer>
        </section>
      </div>
    </main>
  );
}
