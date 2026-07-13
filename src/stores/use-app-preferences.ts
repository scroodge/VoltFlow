import { createJSONStorage, persist } from "zustand/middleware";
import { create } from "zustand";

import { isCarGeneration, type CarGeneration } from "@/lib/car-generations";
import {
  isCurrency,
  isLocale,
  type Currency,
  type Locale,
} from "@/lib/i18n";
import {
  appPreferencesStorageKey,
  initialAppPreferences,
  isChargingProviderType,
  isChargingTariffType,
  type PersistedParkEstimate,
} from "@/lib/app-preferences";
import type {
  ChargingProviderType,
  ChargingTariffType,
} from "@/types/database";

type AppPreferencesState = {
  selectedCarId: string | null;
  defaultPricePerKwh: number;
  homePricePerKwh: number;
  commercialAcPricePerKwh: number;
  fastDcPricePerKwh: number;
  currency: Currency;
  locale: Locale;
  onboardingSkipped: boolean;
  onboardingCarGeneration: CarGeneration | null;
  parkEstimateTariffType: ChargingTariffType | null;
  parkEstimateProviderType: ChargingProviderType | null;
  parkEstimateUserProviderId: string | null;
  parkEstimatePowerKw: string | null;
  parkEstimateTariffTouched: boolean;
  parkEstimateProviderTouched: boolean;
  parkEstimatePowerTouched: boolean;
  setParkEstimate: (patch: Partial<PersistedParkEstimate>) => void;
  setSelectedCarId: (id: string | null) => void;
  setDefaultPricePerKwh: (n: number) => void;
  setTariffPrices: (input: {
    homePricePerKwh: number;
    commercialAcPricePerKwh: number;
    fastDcPricePerKwh: number;
  }) => void;
  setCurrency: (currency: Currency) => void;
  setLocale: (locale: Locale) => void;
  setOnboardingSkipped: (skipped: boolean) => void;
  setOnboardingCarGeneration: (generation: CarGeneration | null) => void;
};

const noopStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

export const useAppPreferences = create(
  persist<AppPreferencesState>(
    (set) => ({
      ...initialAppPreferences,
      setSelectedCarId: (selectedCarId) => set({ selectedCarId }),
      setDefaultPricePerKwh: (defaultPricePerKwh) =>
        set({ defaultPricePerKwh }),
      setTariffPrices: ({
        homePricePerKwh,
        commercialAcPricePerKwh,
        fastDcPricePerKwh,
      }) =>
        set({
          defaultPricePerKwh: homePricePerKwh,
          homePricePerKwh,
          commercialAcPricePerKwh,
          fastDcPricePerKwh,
        }),
      setCurrency: (currency) => set({ currency }),
      setLocale: (locale) => set({ locale }),
      setOnboardingSkipped: (onboardingSkipped) => set({ onboardingSkipped }),
      setOnboardingCarGeneration: (onboardingCarGeneration) =>
        set({ onboardingCarGeneration }),
      setParkEstimate: (patch) => set(patch),
    }),
    {
      name: appPreferencesStorageKey,
      storage: createJSONStorage(() =>
        typeof window === "undefined" ? noopStorage : window.localStorage,
      ),
      merge: (persisted, current) => {
        const saved = persisted as Partial<AppPreferencesState> | undefined;
        const fallbackPrice =
          typeof saved?.defaultPricePerKwh === "number" &&
          Number.isFinite(saved.defaultPricePerKwh)
            ? saved.defaultPricePerKwh
            : current.defaultPricePerKwh;
        return {
          ...current,
          ...saved,
          defaultPricePerKwh: fallbackPrice,
          homePricePerKwh:
            typeof saved?.homePricePerKwh === "number" &&
            Number.isFinite(saved.homePricePerKwh)
              ? saved.homePricePerKwh
              : fallbackPrice,
          commercialAcPricePerKwh:
            typeof saved?.commercialAcPricePerKwh === "number" &&
            Number.isFinite(saved.commercialAcPricePerKwh)
              ? saved.commercialAcPricePerKwh
              : fallbackPrice,
          fastDcPricePerKwh:
            typeof saved?.fastDcPricePerKwh === "number" &&
            Number.isFinite(saved.fastDcPricePerKwh)
              ? saved.fastDcPricePerKwh
              : fallbackPrice,
          currency:
            saved?.currency && isCurrency(saved.currency)
              ? saved.currency
              : current.currency,
          locale:
            saved?.locale && isLocale(saved.locale)
              ? saved.locale
              : current.locale,
          onboardingSkipped:
            typeof saved?.onboardingSkipped === "boolean"
              ? saved.onboardingSkipped
              : current.onboardingSkipped,
          onboardingCarGeneration: isCarGeneration(saved?.onboardingCarGeneration)
            ? saved.onboardingCarGeneration
            : current.onboardingCarGeneration,
          parkEstimateTariffType: isChargingTariffType(saved?.parkEstimateTariffType)
            ? saved.parkEstimateTariffType
            : current.parkEstimateTariffType,
          parkEstimateProviderType: isChargingProviderType(
            saved?.parkEstimateProviderType,
          )
            ? saved.parkEstimateProviderType
            : current.parkEstimateProviderType,
          parkEstimateUserProviderId:
            typeof saved?.parkEstimateUserProviderId === "string" ||
            saved?.parkEstimateUserProviderId === null
              ? saved.parkEstimateUserProviderId
              : current.parkEstimateUserProviderId,
          parkEstimatePowerKw:
            typeof saved?.parkEstimatePowerKw === "string"
              ? saved.parkEstimatePowerKw
              : current.parkEstimatePowerKw,
          parkEstimateTariffTouched:
            typeof saved?.parkEstimateTariffTouched === "boolean"
              ? saved.parkEstimateTariffTouched
              : current.parkEstimateTariffTouched,
          parkEstimateProviderTouched:
            typeof saved?.parkEstimateProviderTouched === "boolean"
              ? saved.parkEstimateProviderTouched
              : current.parkEstimateProviderTouched,
          parkEstimatePowerTouched:
            typeof saved?.parkEstimatePowerTouched === "boolean"
              ? saved.parkEstimatePowerTouched
              : current.parkEstimatePowerTouched,
        };
      },
      /* zustand typings expect the full store; we only persist primitives. */
      partialize: (s) => ({
        selectedCarId: s.selectedCarId,
        defaultPricePerKwh: s.defaultPricePerKwh,
        homePricePerKwh: s.homePricePerKwh,
        commercialAcPricePerKwh: s.commercialAcPricePerKwh,
        fastDcPricePerKwh: s.fastDcPricePerKwh,
        currency: s.currency,
        locale: s.locale,
        onboardingSkipped: s.onboardingSkipped,
        onboardingCarGeneration: s.onboardingCarGeneration,
        parkEstimateTariffType: s.parkEstimateTariffType,
        parkEstimateProviderType: s.parkEstimateProviderType,
        parkEstimateUserProviderId: s.parkEstimateUserProviderId,
        parkEstimatePowerKw: s.parkEstimatePowerKw,
        parkEstimateTariffTouched: s.parkEstimateTariffTouched,
        parkEstimateProviderTouched: s.parkEstimateProviderTouched,
        parkEstimatePowerTouched: s.parkEstimatePowerTouched,
      }) as unknown as AppPreferencesState,
    },
  ),
);
