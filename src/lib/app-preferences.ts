import { isCarGeneration, type CarGeneration } from "./car-generations.ts";
import {
  defaultCurrency,
  defaultLocale,
  isCurrency,
  isLocale,
  type Currency,
  type Locale,
} from "./i18n.ts";

import type {
  ChargingProviderType,
  ChargingTariffType,
} from "../types/database.ts";

export const appPreferencesStorageKey = "ev-charge-preferences";

const CHARGING_TARIFF_TYPES = ["home", "commercial_ac", "fast_dc"] as const;
const CHARGING_PROVIDER_TYPES = [
  "home",
  "malanka",
  "evika",
  "forevo",
  "zaryadka",
  "batterfly",
  "user_provider",
  "custom",
] as const;

export function isChargingTariffType(value: unknown): value is ChargingTariffType {
  return (CHARGING_TARIFF_TYPES as readonly unknown[]).includes(value);
}

export function isChargingProviderType(value: unknown): value is ChargingProviderType {
  return (CHARGING_PROVIDER_TYPES as readonly unknown[]).includes(value);
}

/**
 * The dashboard park-charge calculator's last choices. `*Touched` records that the
 * user set the field by hand, which is what makes it survive a reload: untouched
 * fields keep auto-filling from the GPS-matched tariff location instead.
 */
export type PersistedParkEstimate = {
  parkEstimateTariffType: ChargingTariffType | null;
  parkEstimateProviderType: ChargingProviderType | null;
  parkEstimateUserProviderId: string | null;
  parkEstimatePowerKw: string | null;
  parkEstimateTariffTouched: boolean;
  parkEstimateProviderTouched: boolean;
  parkEstimatePowerTouched: boolean;
};

export type PersistedAppPreferences = {
  selectedCarId: string | null;
  defaultPricePerKwh: number;
  homePricePerKwh: number;
  commercialAcPricePerKwh: number;
  fastDcPricePerKwh: number;
  currency: Currency;
  locale: Locale;
  onboardingSkipped: boolean;
  onboardingCarGeneration: CarGeneration | null;
} & PersistedParkEstimate;

type StorageLike = {
  getItem: (key: string) => string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parsePersistedAppPreferences(
  value: string | null,
): Partial<PersistedAppPreferences> | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as unknown;
    const state = isRecord(parsed) && isRecord(parsed.state) ? parsed.state : parsed;
    if (!isRecord(state)) return null;

    const preferences: Partial<PersistedAppPreferences> = {};

    if (typeof state.selectedCarId === "string" || state.selectedCarId === null) {
      preferences.selectedCarId = state.selectedCarId;
    }

    if (
      typeof state.defaultPricePerKwh === "number" &&
      Number.isFinite(state.defaultPricePerKwh)
    ) {
      preferences.defaultPricePerKwh = state.defaultPricePerKwh;
    }
    if (
      typeof state.homePricePerKwh === "number" &&
      Number.isFinite(state.homePricePerKwh)
    ) {
      preferences.homePricePerKwh = state.homePricePerKwh;
    }
    if (
      typeof state.commercialAcPricePerKwh === "number" &&
      Number.isFinite(state.commercialAcPricePerKwh)
    ) {
      preferences.commercialAcPricePerKwh = state.commercialAcPricePerKwh;
    }
    if (
      typeof state.fastDcPricePerKwh === "number" &&
      Number.isFinite(state.fastDcPricePerKwh)
    ) {
      preferences.fastDcPricePerKwh = state.fastDcPricePerKwh;
    }

    if (typeof state.currency === "string" && isCurrency(state.currency)) {
      preferences.currency = state.currency;
    }

    if (typeof state.locale === "string" && isLocale(state.locale)) {
      preferences.locale = state.locale;
    }

    if (typeof state.onboardingSkipped === "boolean") {
      preferences.onboardingSkipped = state.onboardingSkipped;
    }

    if (
      state.onboardingCarGeneration === null ||
      isCarGeneration(state.onboardingCarGeneration)
    ) {
      preferences.onboardingCarGeneration = state.onboardingCarGeneration;
    }

    if (isChargingTariffType(state.parkEstimateTariffType)) {
      preferences.parkEstimateTariffType = state.parkEstimateTariffType;
    }
    if (isChargingProviderType(state.parkEstimateProviderType)) {
      preferences.parkEstimateProviderType = state.parkEstimateProviderType;
    }
    if (
      typeof state.parkEstimateUserProviderId === "string" ||
      state.parkEstimateUserProviderId === null
    ) {
      preferences.parkEstimateUserProviderId = state.parkEstimateUserProviderId;
    }
    if (typeof state.parkEstimatePowerKw === "string") {
      preferences.parkEstimatePowerKw = state.parkEstimatePowerKw;
    }
    if (typeof state.parkEstimateTariffTouched === "boolean") {
      preferences.parkEstimateTariffTouched = state.parkEstimateTariffTouched;
    }
    if (typeof state.parkEstimateProviderTouched === "boolean") {
      preferences.parkEstimateProviderTouched = state.parkEstimateProviderTouched;
    }
    if (typeof state.parkEstimatePowerTouched === "boolean") {
      preferences.parkEstimatePowerTouched = state.parkEstimatePowerTouched;
    }

    return preferences;
  } catch {
    return null;
  }
}

export function getPersistedAppPreferences(storage: StorageLike) {
  return parsePersistedAppPreferences(storage.getItem(appPreferencesStorageKey));
}

export function hasPersistedLocalePreference(storage: StorageLike) {
  return Boolean(getPersistedAppPreferences(storage)?.locale);
}

export const initialAppPreferences: PersistedAppPreferences = {
  selectedCarId: null,
  defaultPricePerKwh: 0.12,
  homePricePerKwh: 0.12,
  commercialAcPricePerKwh: 0.12,
  fastDcPricePerKwh: 0.12,
  currency: defaultCurrency,
  locale: defaultLocale,
  onboardingSkipped: false,
  onboardingCarGeneration: null,
  parkEstimateTariffType: null,
  parkEstimateProviderType: null,
  parkEstimateUserProviderId: null,
  parkEstimatePowerKw: null,
  parkEstimateTariffTouched: false,
  parkEstimateProviderTouched: false,
  parkEstimatePowerTouched: false,
};
