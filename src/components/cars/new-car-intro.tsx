"use client";

import { useTranslation } from "@/hooks/use-translation";

export function NewCarIntro() {
  const { t } = useTranslation();

  return (
    <div>
      <p className="text-muted-foreground text-xs uppercase tracking-[0.42em]">
        {t("cars.newEyebrow")}
      </p>
      <h1 className="mt-[1.425rem] text-balance text-[2.725rem] font-semibold tracking-tight drop-shadow-xl">
        {t("cars.newHeading")}
      </h1>
      <p className="text-muted-foreground mx-auto mt-8 max-w-2xl text-lg leading-snug tracking-tight text-balance">
        {t("cars.newIntro")}
      </p>
    </div>
  );
}
