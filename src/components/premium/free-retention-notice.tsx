"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { useTranslation } from "@/hooks/use-translation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type RetentionStatusPayload = {
  ok: boolean;
  isPremium: boolean;
  retentionDays: number;
  oldestKeptDate: string;
  nextDeletionDate: string;
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
    <Card size="sm" className="border-amber-300/30 bg-amber-400/5">
      <CardHeader>
        <CardTitle>{t("settings.retentionNotice.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {t("settings.retentionNotice.body", { days: status?.retentionDays ?? 30 })}
        </p>
        <p className="text-xs text-muted-foreground">
          {t("settings.retentionNotice.nextDeletion", { date: nextDeletionText })}
        </p>
        <Button asChild size="lg" className="h-11 w-full rounded-full text-sm font-semibold">
          <Link href="/support">{t("settings.retentionNotice.upgradeCta")}</Link>
        </Button>
        <p className="text-xs text-muted-foreground">
          {t("settings.retentionNotice.emailHelp", { email: status?.upgradeEmail ?? "" })}
        </p>
      </CardContent>
    </Card>
  );
}
