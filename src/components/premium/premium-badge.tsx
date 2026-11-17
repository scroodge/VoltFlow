"use client";

import { Crown } from "lucide-react";

import { useEntitlementQuery } from "@/hooks/use-entitlement-query";
import { useTranslation } from "@/hooks/use-translation";

export function PremiumBadge({
  className,
  compact = false,
}: {
  className?: string;
  /** Below 400 px show only the crown, so a long car name keeps its room. */
  compact?: boolean;
}) {
  const { data } = useEntitlementQuery();
  const { t } = useTranslation();

  if (!data?.isPremium) return null;

  const label = t("settings.premiumBadge") as string;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--voltflow-green)]/30 bg-[var(--voltflow-green)]/10 px-2.5 py-1 text-[11px] font-semibold text-[var(--voltflow-green)] ${compact ? "max-[399px]:px-1.5" : ""} ${className ?? ""}`}
      title={compact ? label : undefined}
    >
      <Crown className="size-3" aria-hidden />
      <span className={compact ? "max-[399px]:sr-only" : undefined}>
        {label}
      </span>
    </span>
  );
}
