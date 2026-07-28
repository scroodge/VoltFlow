"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { Toaster } from "@/components/ui/sonner";
import { ServiceWorkerRegistrar } from "@/components/sw-register";
import { hasPersistedLocalePreference } from "@/lib/app-preferences";
import {
  dashboardPreferencesCookieName,
  serializeDashboardBrowserPreferences,
} from "@/lib/dashboard-preferences";
import { createClient } from "@/lib/supabase/client";
import { isCurrency, isLocale } from "@/lib/i18n";
import { useAppPreferences } from "@/stores/use-app-preferences";

export function Providers({ children }: { children: React.ReactNode }) {
  const locale = useAppPreferences((s) => s.locale);
  const selectedCarId = useAppPreferences((s) => s.selectedCarId);
  const setCurrency = useAppPreferences((s) => s.setCurrency);
  const setDefaultPricePerKwh = useAppPreferences(
    (s) => s.setDefaultPricePerKwh,
  );
  const setLocale = useAppPreferences((s) => s.setLocale);
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 10_000,
            refetchOnWindowFocus: true,
          },
        },
      }),
  );

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    const value = serializeDashboardBrowserPreferences({ selectedCarId, locale });
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${dashboardPreferencesCookieName}=${value}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
  }, [locale, selectedCarId]);

  useEffect(() => {
    let mounted = true;
    const supabase = createClient();

    void supabase.auth.getUser().then(async ({ data }) => {
      const user = data.user;
      if (!user) return;

      const { data: profile } = await supabase
        .from("profiles")
        .select("preferred_currency, preferred_locale, default_price_per_kwh")
        .eq("id", user.id)
        .single();

      if (!mounted || !profile) return;

      const preferredCurrency = profile.preferred_currency;
      if (typeof preferredCurrency === "string" && isCurrency(preferredCurrency)) {
        setCurrency(preferredCurrency);
      }

      const preferredLocale = profile.preferred_locale;
      const hasLocalLocale =
        typeof window !== "undefined" &&
        hasPersistedLocalePreference(window.localStorage);
      if (
        typeof preferredLocale === "string" &&
        isLocale(preferredLocale) &&
        !hasLocalLocale
      ) {
        setLocale(preferredLocale);
      }

      const defaultPrice = Number(profile.default_price_per_kwh);
      if (Number.isFinite(defaultPrice) && defaultPrice >= 0) {
        setDefaultPricePerKwh(defaultPrice);
      }
    });

    return () => {
      mounted = false;
    };
  }, [setCurrency, setDefaultPricePerKwh, setLocale]);

  return (
    <QueryClientProvider client={client}>
      {children}
      <Toaster richColors theme="dark" position="top-center" />
      <ServiceWorkerRegistrar />
    </QueryClientProvider>
  );
}
