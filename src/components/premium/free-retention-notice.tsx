"use client";

import { useEffect, useState } from "react";

import { PremiumFeatureGate } from "@/components/premium/premium-feature-gate";
import { useTranslation } from "@/hooks/use-translation";

type RetentionStatusPayload = {
  ok: boolean;
  isPremium: boolean;
  retentionDays: number | null;
  oldestKeptDate: string | null;
  nextDeletionDate: string | null;
  upgradeEmail: string;
};

export function FreeRetentionNotice() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<RetentionStatusPayload | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/vehicle/retention-status", { credentials: "include" })
      .then(async (response) => {
        const payload = (await response.json()) as RetentionStatusPayload;
        if (!active || !response.ok || !payload.ok) return;
        setStatus(payload);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const nextDeletionText = (() => {
    if (!status?.nextDeletionDate) return String(t("common.unavailable"));
    const date = new Date(status.nextDeletionDate);
    return Number.isNaN(date.getTime())
      ? String(t("common.unavailable"))
      : `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
  })();

  if (loading || status?.isPremium) return null;

  return (
    <PremiumFeatureGate title={t("settings.retentionNotice.title")}>
      <p className="text-sm text-muted-foreground">
        {t("settings.retentionNotice.body", { days: status?.retentionDays ?? 30 })}
      </p>
      <p className="text-xs text-muted-foreground">
        {t("settings.retentionNotice.nextDeletion", { date: nextDeletionText })}
      </p>
      <p className="text-xs text-muted-foreground">
        {t("settings.retentionNotice.emailHelp", { email: status?.upgradeEmail ?? "" })}
      </p>
    </PremiumFeatureGate>
  );
}
