"use client";

import Link from "next/link";
import { ExternalLink, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTranslation } from "@/hooks/use-translation";

export function AdminLinks() {
  const { t } = useTranslation();

  return (
    <>
      <Card size="sm" className="border-white/[0.08]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck
              className="size-5 text-[var(--voltflow-green)]"
              aria-hidden
            />
            {t("settings.adminCms.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-muted-foreground text-sm leading-relaxed">
            {t("settings.adminCms.description")}
          </p>
          <Button
            asChild
            variant="secondary"
            size="lg"
            className="h-11 w-full justify-between rounded-full px-4 text-sm font-semibold"
          >
            <Link href="/admin/knowledge">
              <span className="inline-flex items-center gap-3">
                <ShieldCheck className="size-5" aria-hidden />
                {t("settings.adminCms.open")}
              </span>
              <ExternalLink className="size-4" aria-hidden />
            </Link>
          </Button>
        </CardContent>
      </Card>

      <Card size="sm" className="border-white/[0.08]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck
              className="size-5 text-[var(--voltflow-cyan)]"
              aria-hidden
            />
            {t("settings.adminPremium.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-muted-foreground text-sm leading-relaxed">
            {t("settings.adminPremium.description")}
          </p>
          <Button
            asChild
            variant="secondary"
            size="lg"
            className="h-11 w-full justify-between rounded-full px-4 text-sm font-semibold"
          >
            <Link href="/admin/users">
              <span className="inline-flex items-center gap-3">
                <ShieldCheck className="size-5" aria-hidden />
                {t("settings.adminPremium.open")}
              </span>
              <ExternalLink className="size-4" aria-hidden />
            </Link>
          </Button>
        </CardContent>
      </Card>
    </>
  );
}
