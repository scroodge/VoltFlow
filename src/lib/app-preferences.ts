import {
  defaultCurrency,
  defaultLocale,
  isCurrency,
  isLocale,
  type Currency,
  type Locale,
} from "./i18n.ts";

export const appPreferencesStorageKey = "ev-charge-preferences";

export type PersistedAppPreferences = {
  selectedCarId: string | null;
  defaultPricePerKwh: number;
  homePricePerKwh: number;
  commercialAcPricePerKwh: number;
  fastDcPricePerKwh: number;
  currency: Currency;
  locale: Locale;
};

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
};
