"use client";

import { Crown } from "lucide-react";

import { useEntitlementQuery } from "@/hooks/use-entitlement-query";
import { useTranslation } from "@/hooks/use-translation";

export function PremiumBadge({ className }: { className?: string }) {
  const { data } = useEntitlementQuery();
  const { t } = useTranslation();

  if (!data?.isPremium) return null;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border border-[var(--voltflow-green)]/30 bg-[var(--voltflow-green)]/10 px-2.5 py-1 text-[11px] font-semibold text-[var(--voltflow-green)] ${className ?? ""}`}
    >
      <Crown className="size-3" aria-hidden />
      {t("settings.premiumBadge")}
    </span>
  );
}
