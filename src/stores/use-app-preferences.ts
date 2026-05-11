import { createJSONStorage, persist } from "zustand/middleware";
import { create } from "zustand";

import {
  defaultCurrency,
  defaultLocale,
  isCurrency,
  isLocale,
  type Currency,
  type Locale,
} from "@/lib/i18n";

type AppPreferencesState = {
  selectedCarId: string | null;
  defaultPricePerKwh: number;
  currency: Currency;
  locale: Locale;
  setSelectedCarId: (id: string | null) => void;
  setDefaultPricePerKwh: (n: number) => void;
  setCurrency: (currency: Currency) => void;
  setLocale: (locale: Locale) => void;
};

export const useAppPreferences = create(
  persist<AppPreferencesState>(
    (set) => ({
      selectedCarId: null,
      defaultPricePerKwh: 0.12,
      currency: defaultCurrency,
      locale: defaultLocale,
      setSelectedCarId: (selectedCarId) => set({ selectedCarId }),
      setDefaultPricePerKwh: (defaultPricePerKwh) =>
        set({ defaultPricePerKwh }),
      setCurrency: (currency) => set({ currency }),
      setLocale: (locale) => set({ locale }),
    }),
    {
      name: "ev-charge-preferences",
      storage: createJSONStorage(() => localStorage),
      merge: (persisted, current) => {
        const saved = persisted as Partial<AppPreferencesState> | undefined;
        return {
          ...current,
          ...saved,
          currency:
            saved?.currency && isCurrency(saved.currency)
              ? saved.currency
              : current.currency,
          locale:
            saved?.locale && isLocale(saved.locale)
              ? saved.locale
              : current.locale,
        };
      },
      /* zustand typings expect the full store; we only persist primitives. */
      partialize: (s) => ({
        selectedCarId: s.selectedCarId,
        defaultPricePerKwh: s.defaultPricePerKwh,
        currency: s.currency,
        locale: s.locale,
      }) as unknown as AppPreferencesState,
    },
  ),
);
