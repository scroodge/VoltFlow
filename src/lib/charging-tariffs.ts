import { haversineDistanceM } from "./home-charger-geofence.ts";
import type {
  ChargingProviderType,
  ChargingTariffLocationRow,
  ChargingTariffType,
  Profile,
  UserProviderRow,
} from "../types/database.ts";
export const COMMERCIAL_AC_MIN_KW = 4;
export const FAST_DC_MIN_KW = 10;

export type TariffPriceProfile = Pick<
  Profile,
  | "default_price_per_kwh"
  | "home_price_per_kwh"
  | "commercial_ac_price_per_kwh"
  | "fast_dc_price_per_kwh"
>;

export type TariffResolution = {
  tariffType: ChargingTariffType;
  providerType: ChargingProviderType;
  userProviderId: string | null;
  pricePerKwh: number;
  source: "manual" | "location" | "power";
  locationPresetId: string | null;
};

export const PROVIDER_LABELS: Record<ChargingProviderType, string> = {
  home: "Home",
  malanka: "Malanka",
  evika: "Evika!",
  forevo: "forEVo",
  zaryadka: "Zaryadka",
  batterfly: "BatteryFly",
  user_provider: "Custom",
  custom: "Custom",
};

/**
 * Historical fallback only. Providers are now user-owned rows in `user_providers`
 * (seeded from these same values on signup/first Settings load — see
 * defaultUserProviderSeeds) — a user can reprice or delete any of them except
 * Home. This table stays so `charging_sessions`/`charging_tariff_locations` rows
 * still tagged with a bare enum value (from before the fold-in migration,
 * `20260706200000_fold_builtin_providers_into_user_providers.sql`) keep resolving
 * to a sensible price. Never read for new picks, which always go through
 * `resolveUserProviderPrices`.
 */
export const PROVIDER_TARIFF_PRESETS: Record<
  Exclude<ChargingProviderType, "custom" | "user_provider">,
  { home: number; commercial_ac: number; fast_dc: number }
> = {
  home: { home: 0.15, commercial_ac: 0.54, fast_dc: 0.54 },
  malanka: { home: 0.55, commercial_ac: 0.55, fast_dc: 0.73 },
  evika: { home: 0.54, commercial_ac: 0.54, fast_dc: 0.72 },
  forevo: { home: 0.46, commercial_ac: 0.46, fast_dc: 0.61 },
  zaryadka: { home: 0.48, commercial_ac: 0.48, fast_dc: 0.61 },
  batterfly: { home: 0.50, commercial_ac: 0.50, fast_dc: 0.45 },
};

/** The 6 providers every user's `user_providers` table is seeded with (existing
 * users via the fold-in migration, new users via lazy-seed-on-first-load in
 * settings-view.tsx). Home is permanent (`is_default`); the rest behave exactly
 * like a provider the user typed in themselves — repriceable and deletable. */
export function defaultUserProviderSeeds(): {
  label: string;
  home_price_per_kwh: number;
  commercial_ac_price_per_kwh: number;
  fast_dc_price_per_kwh: number;
  is_default: boolean;
}[] {
  return (
    ["home", "malanka", "evika", "forevo", "zaryadka", "batterfly"] as const
  ).map((provider) => ({
    label: PROVIDER_LABELS[provider],
    home_price_per_kwh: PROVIDER_TARIFF_PRESETS[provider].home,
    commercial_ac_price_per_kwh: PROVIDER_TARIFF_PRESETS[provider].commercial_ac,
    fast_dc_price_per_kwh: PROVIDER_TARIFF_PRESETS[provider].fast_dc,
    is_default: provider === "home",
  }));
}

export type UserProviderMap = Record<string, UserProviderRow>;

export function userProvidersFromRows(rows: UserProviderRow[]): UserProviderMap {
  const map: UserProviderMap = {};
  for (const row of rows) {
    map[row.id] = row;
  }
  return map;
}

/** The user's permanent Home provider row, if their `user_providers` have been
 * seeded yet. Used as the auto-tier fallback for home-power charging with no
 * manual pick and no GPS match. */
export function findDefaultHomeProvider(
  userProviderMap: UserProviderMap | undefined,
): UserProviderRow | null {
  if (!userProviderMap) return null;
  return Object.values(userProviderMap).find((row) => row.is_default) ?? null;
}

export function resolveUserProviderPrices(
  userProviderId: string | null | undefined,
  userProviderMap: UserProviderMap | undefined,
): { home: number; commercial_ac: number; fast_dc: number } | null {
  if (!userProviderId || !userProviderMap) return null;
  const row = userProviderMap[userProviderId];
  if (!row) return null;
  return {
    home: row.home_price_per_kwh,
    commercial_ac: row.commercial_ac_price_per_kwh,
    fast_dc: row.fast_dc_price_per_kwh,
  };
}

export function resolveProviderTariff(
  providerType: Exclude<ChargingProviderType, "custom">,
  userProviderId?: string | null,
  userProviderMap?: UserProviderMap,
): { home: number; commercial_ac: number; fast_dc: number } {
  if (providerType === "user_provider") {
    const userPrices = resolveUserProviderPrices(userProviderId, userProviderMap);
    if (userPrices) return userPrices;
    return { home: 0, commercial_ac: 0, fast_dc: 0 };
  }
  return PROVIDER_TARIFF_PRESETS[providerType];
}

export function normalizeTariffType(value: unknown): ChargingTariffType {
  return value === "commercial_ac" || value === "fast_dc" || value === "home"
    ? value
    : "home";
}

export function normalizeProviderType(value: unknown): ChargingProviderType {
  return value === "home" ||
    value === "malanka" ||
    value === "evika" ||
    value === "forevo" ||
    value === "zaryadka" ||
    value === "batterfly" ||
    value === "user_provider" ||
    value === "custom"
    ? (value as ChargingProviderType)
    : "custom";
}

export function resolveTariffTypeByPower(chargerPowerKw: number): ChargingTariffType {
  if (!Number.isFinite(chargerPowerKw)) return "home";
  if (chargerPowerKw >= FAST_DC_MIN_KW) return "fast_dc";
  if (chargerPowerKw >= COMMERCIAL_AC_MIN_KW) return "commercial_ac";
  return "home";
}

export function resolveTariffPrice(
  tariffType: ChargingTariffType,
  profile: TariffPriceProfile | null | undefined,
  providerType: ChargingProviderType = "custom",
  userProviderId?: string | null,
  userProviderMap?: UserProviderMap,
): number {
  if (providerType !== "custom") {
    const preset = resolveProviderTariff(providerType, userProviderId, userProviderMap);
    return preset[tariffType];
  }
  const fallback = Number(profile?.default_price_per_kwh ?? 0);
  const home = Number(profile?.home_price_per_kwh ?? fallback);
  const ac = Number(profile?.commercial_ac_price_per_kwh ?? fallback);
  const dc = Number(profile?.fast_dc_price_per_kwh ?? fallback);
  if (tariffType === "commercial_ac") return Number.isFinite(ac) ? ac : 0;
  if (tariffType === "fast_dc") return Number.isFinite(dc) ? dc : 0;
  return Number.isFinite(home) ? home : 0;
}

export function matchNearestTariffLocation(
  location: { lat?: number | null; lon?: number | null } | null | undefined,
  presets: ChargingTariffLocationRow[],
): ChargingTariffLocationRow | null {
  const lat = location?.lat;
  const lon = location?.lon;
  if (typeof lat !== "number" || typeof lon !== "number") return null;

  let best: { preset: ChargingTariffLocationRow; distanceM: number } | null = null;
  for (const preset of presets) {
    const distanceM = haversineDistanceM(lat, lon, preset.lat, preset.lng);
    if (distanceM > preset.radius_m) continue;
    if (!best || distanceM < best.distanceM) {
      best = { preset, distanceM };
    }
  }
  return best?.preset ?? null;
}

export function resolveSessionTariff(params: {
  manualPricePerKwh?: number;
  manualTariffType?: ChargingTariffType | null;
  manualProviderType?: ChargingProviderType | null;
  userProviderId?: string | null;
  chargerPowerKw: number;
  location: { lat?: number | null; lon?: number | null } | null | undefined;
  locationPresets: ChargingTariffLocationRow[];
  profile: TariffPriceProfile | null | undefined;
  userProviderMap?: UserProviderMap;
}): TariffResolution {
  const manualPrice = Number(params.manualPricePerKwh ?? 0);
  const providerType = normalizeProviderType(params.manualProviderType ?? "custom");
  const userProviderId =
    providerType === "user_provider" ? (params.userProviderId ?? null) : null;
  if (manualPrice > 0) {
    const tariffType = normalizeTariffType(
      params.manualTariffType ?? resolveTariffTypeByPower(params.chargerPowerKw),
    );
    return {
      tariffType,
      providerType,
      userProviderId,
      pricePerKwh: manualPrice,
      source: "manual",
      locationPresetId: null,
    };
  }

  const matched = matchNearestTariffLocation(params.location, params.locationPresets);
  if (matched) {
    const type = normalizeTariffType(matched.tariff_type);
    const matchedProvider = normalizeProviderType(matched.provider_type);
    const matchedUserProviderId =
      matchedProvider === "user_provider" ? (matched.user_provider_id ?? null) : null;
    const override = Number(matched.price_per_kwh_override ?? 0);
    return {
      tariffType: type,
      providerType: matchedProvider,
      userProviderId: matchedUserProviderId,
      pricePerKwh:
        override > 0
          ? override
          : resolveTariffPrice(
              type,
              params.profile,
              matchedProvider,
              matchedUserProviderId,
              params.userProviderMap,
            ),
      source: "location",
      locationPresetId: matched.id,
    };
  }

  const tariffType = resolveTariffTypeByPower(params.chargerPowerKw);
  // Home-tier auto-fallback resolves through the user's permanent Home provider
  // row (is_default) so it reflects any price the user has set, not a hardcoded
  // constant. Falls back to "custom" (profile.home_price_per_kwh) only if the
  // seed hasn't run yet for this user (should not happen once seeded).
  const defaultHomeProvider = findDefaultHomeProvider(params.userProviderMap);
  const autoProvider: ChargingProviderType =
    tariffType === "home" ? (defaultHomeProvider ? "user_provider" : "custom") : "custom";
  const autoUserProviderId = autoProvider === "user_provider" ? (defaultHomeProvider?.id ?? null) : null;
  return {
    tariffType,
    providerType: autoProvider,
    userProviderId: autoUserProviderId,
    pricePerKwh: resolveTariffPrice(tariffType, params.profile, autoProvider, autoUserProviderId, params.userProviderMap),
    source: "power",
    locationPresetId: null,
  };
}
