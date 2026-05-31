"use client";

import Link from "next/link";
import { BarChart3, ChevronRight } from "lucide-react";

import { useTranslation } from "@/hooks/use-translation";
import { useAppPath } from "@/lib/dev/dev-path";
import type { TranslationKey } from "@/lib/i18n";

type Translator = (key: TranslationKey, values?: Record<string, string | number>) => string;

export function VehicleAnalyticsTeaser() {
  const { t } = useTranslation();
  const tx = t as Translator;
  const appPath = useAppPath();

  return (
    <section className="voltflow-card p-4">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 text-primary">
          <BarChart3 className="size-5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-heading text-xl font-semibold tracking-tight">
            {tx("vehicle.analytics.teaserTitle")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {tx("vehicle.analytics.teaserSubtitle")}
          </p>
          <Link
            href={appPath("/history?tab=analytics")}
            className="mt-3 inline-flex items-center gap-1 rounded-full border border-border bg-white/[0.03] px-3 py-1.5 text-sm font-semibold text-foreground transition hover:border-primary/50 hover:text-primary"
          >
            {tx("vehicle.analytics.teaserLink")}
            <ChevronRight className="size-4" aria-hidden />
          </Link>
        </div>
      </div>
    </section>
  );
}
