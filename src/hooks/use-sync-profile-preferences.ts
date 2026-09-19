"use client";

import { useEffect } from "react";

import { useProfileQuery } from "@/hooks/use-profile-query";
import { isCurrency } from "@/lib/i18n";
import { useAppPreferences } from "@/stores/use-app-preferences";

/** Mirrors the profile's currency and default tariffs into the client preference store. */
export function useSyncProfilePreferences() {
  const { data: profile } = useProfileQuery({ refetchOnMount: "always" });
  const setCurrency = useAppPreferences((s) => s.setCurrency);
  const setTariffPrices = useAppPreferences((s) => s.setTariffPrices);

  useEffect(() => {
    if (!profile) return;

    if (isCurrency(profile.preferred_currency)) {
      setCurrency(profile.preferred_currency);
    }

    const fallback = profile.default_price_per_kwh;
    const home = Number(profile.home_price_per_kwh ?? fallback);
    const commercial = Number(profile.commercial_ac_price_per_kwh ?? fallback);
    const dc = Number(profile.fast_dc_price_per_kwh ?? fallback);
    if (
      Number.isFinite(home) &&
      Number.isFinite(commercial) &&
      Number.isFinite(dc) &&
      home >= 0 &&
      commercial >= 0 &&
      dc >= 0
    ) {
      setTariffPrices({
        homePricePerKwh: home,
        commercialAcPricePerKwh: commercial,
        fastDcPricePerKwh: dc,
      });
    }
  }, [profile, setCurrency, setTariffPrices]);
}
