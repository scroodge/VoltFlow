import { haversineDistanceM } from "./home-charger-geofence.ts";
import type {
  ChargingProviderType,
  ChargingTariffLocationRow,
  ChargingTariffType,
  Profile,
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
  custom: "Custom",
};

export const PROVIDER_TARIFF_PRESETS: Record<
  Exclude<ChargingProviderType, "custom">,
  { home: number; commercial_ac: number; fast_dc: number }
> = {
  home: { home: 0.15, commercial_ac: 0.54, fast_dc: 0.54 },
  malanka: { home: 0.55, commercial_ac: 0.55, fast_dc: 0.73 },
  evika: { home: 0.54, commercial_ac: 0.54, fast_dc: 0.72 },
  forevo: { home: 0.46, commercial_ac: 0.46, fast_dc: 0.61 },
  zaryadka: { home: 0.48, commercial_ac: 0.48, fast_dc: 0.61 },
  batterfly: { home: 0.50, commercial_ac: 0.50, fast_dc: 0.45 },
};

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
    value === "custom"
    ? value
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
): number {
  if (providerType !== "custom") {
    const preset = PROVIDER_TARIFF_PRESETS[providerType];
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
  chargerPowerKw: number;
  location: { lat?: number | null; lon?: number | null } | null | undefined;
  locationPresets: ChargingTariffLocationRow[];
  profile: TariffPriceProfile | null | undefined;
}): TariffResolution {
  const manualPrice = Number(params.manualPricePerKwh ?? 0);
  const providerType = normalizeProviderType(params.manualProviderType ?? "custom");
  if (manualPrice > 0) {
    const tariffType = normalizeTariffType(
      params.manualTariffType ?? resolveTariffTypeByPower(params.chargerPowerKw),
    );
    return {
      tariffType,
      providerType,
      pricePerKwh: manualPrice,
      source: "manual",
      locationPresetId: null,
    };
  }

  const matched = matchNearestTariffLocation(params.location, params.locationPresets);
  if (matched) {
    const type = normalizeTariffType(matched.tariff_type);
    const matchedProvider = normalizeProviderType(matched.provider_type);
    const override = Number(matched.price_per_kwh_override ?? 0);
    return {
      tariffType: type,
      providerType: matchedProvider,
      pricePerKwh:
        override > 0 ? override : resolveTariffPrice(type, params.profile, matchedProvider),
      source: "location",
      locationPresetId: matched.id,
    };
  }

  const tariffType = resolveTariffTypeByPower(params.chargerPowerKw);
  const autoProvider: ChargingProviderType = tariffType === "home" ? "home" : "custom";
  return {
    tariffType,
    providerType: autoProvider,
    pricePerKwh: resolveTariffPrice(tariffType, params.profile, autoProvider),
    source: "power",
    locationPresetId: null,
  };
}
