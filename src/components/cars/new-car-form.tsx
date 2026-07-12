"use client";

import { useRouter } from "next/navigation";
import type { FormEvent } from "react";

import { CarForm } from "@/components/cars/car-form";
import { useCreateCarMutation } from "@/hooks/use-cars-query";
import { useAppPath } from "@/lib/dev/dev-path";
import { normalizeFormDecimal } from "@/lib/number-input";
import { createClient } from "@/lib/supabase/client";
import { useAppPreferences } from "@/stores/use-app-preferences";

export function NewCarForm() {
  const router = useRouter();
  const appPath = useAppPath();
  const mutation = useCreateCarMutation();
  const setCar = useAppPreferences((s) => s.setSelectedCarId);
  const setDefaultPrice = useAppPreferences((s) => s.setDefaultPricePerKwh);
  const setTariffPrices = useAppPreferences((s) => s.setTariffPrices);
  const commercialAcPricePerKwh = useAppPreferences((s) => s.commercialAcPricePerKwh);
  const fastDcPricePerKwh = useAppPreferences((s) => s.fastDcPricePerKwh);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const homePriceRaw = normalizeFormDecimal(fd.get("home_price_per_kwh"));
    const homePrice = typeof homePriceRaw === "string" ? Number(homePriceRaw) : NaN;

    mutation.mutate(fd, {
      onSuccess: (createdId) => {
        setCar(createdId);
        if (Number.isFinite(homePrice) && homePrice > 0) {
          setTariffPrices({
            homePricePerKwh: homePrice,
            commercialAcPricePerKwh,
            fastDcPricePerKwh,
          });
          setDefaultPrice(homePrice);
          const supabase = createClient();
          void supabase.auth.getUser().then(({ data }) => {
            const userId = data.user?.id;
            if (!userId) return;
            void supabase
              .from("profiles")
              .update({ home_price_per_kwh: homePrice, default_price_per_kwh: homePrice })
              .eq("id", userId);
          });
        }
        router.replace(appPath("/dashboard"));
      },
    });
  };

  return (
    <CarForm
      mode="create"
      cancelHref={appPath("/dashboard")}
      isPending={mutation.isPending}
      onSubmit={handleSubmit}
    />
  );
}
