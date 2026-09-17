"use client";

import { Lock } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useEntitlementQuery } from "@/hooks/use-entitlement-query";
import { useTranslation } from "@/hooks/use-translation";

/**
 * Shared "this is a Premium feature" upsell card. Self-contained: resolves entitlement
 * itself (react-query dedupes concurrent callers on the same page against one request)
 * and renders nothing once the viewer is confirmed Premium, so callers only need to
 * supply the feature-specific copy.
 */
export function PremiumFeatureGate({
  title,
  children,
  className,
}: {
  title: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const { t } = useTranslation();
  const { data, isLoading } = useEntitlementQuery();

  if (isLoading || data?.isPremium) return null;

  return (
    <Card size="sm" className={`border-amber-300/30 bg-amber-400/5 ${className ?? ""}`}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lock className="size-4 text-amber-300" aria-hidden />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {children}
        <Button asChild size="lg" className="h-11 w-full rounded-full text-sm font-semibold">
          <Link href="/support">{t("settings.retentionNotice.upgradeCta")}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
