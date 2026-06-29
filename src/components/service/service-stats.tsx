"use client";

import { useMemo } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTranslation } from "@/hooks/use-translation";
import { useUserServiceCategoriesQuery } from "@/hooks/use-service-categories";
import { formatCurrencyAmount } from "@/lib/i18n";
import type { Currency, Locale, TranslationKey } from "@/lib/i18n";
import {
  BUILT_IN_SERVICE_CATEGORIES,
  BUILT_IN_CATEGORY_COLORS,
} from "@/types/service";
import type { ServiceRecordRow } from "@/types/service";

function categoryBarColor(
  cat: string,
  userCatMap: Map<string, string>,
): { className?: string; style?: React.CSSProperties } {
  if ((BUILT_IN_SERVICE_CATEGORIES as readonly string[]).includes(cat)) {
    return { className: BUILT_IN_CATEGORY_COLORS[cat] ?? "bg-gray-400" };
  }
  const color = userCatMap.get(cat) ?? "#6B7280";
  return { style: { backgroundColor: color } };
}

export function ServiceStats({
  records,
  currency,
  locale,
}: {
  records: ServiceRecordRow[];
  currency: Currency;
  locale: Locale;
}) {
  const { t } = useTranslation();
  const { data: userCategories = [] } = useUserServiceCategoriesQuery();

  const userCatMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of userCategories) m.set(c.name, c.color);
    return m;
  }, [userCategories]);

  const totalSpent = useMemo(
    () => records.reduce((sum, r) => sum + (r.total_cost > 0 ? r.total_cost : r.parts_cost + r.labor_cost), 0),
    [records],
  );

  const thisYear = useMemo(() => {
    const year = new Date().getFullYear();
    return records
      .filter((r) => new Date(r.performed_date).getFullYear() === year)
      .reduce((sum, r) => sum + (r.total_cost > 0 ? r.total_cost : r.parts_cost + r.labor_cost), 0);
  }, [records]);

  const avgCost = records.length > 0 ? totalSpent / records.length : 0;

  const byCategory = useMemo(() => {
    const map = new Map<string, { count: number; total: number }>();
    for (const r of records) {
      const cat = r.category;
      const cost = r.total_cost > 0 ? r.total_cost : r.parts_cost + r.labor_cost;
      const existing = map.get(cat) ?? { count: 0, total: 0 };
      map.set(cat, { count: existing.count + 1, total: existing.total + cost });
    }
    return Array.from(map.entries())
      .sort((a, b) => b[1].total - a[1].total);
  }, [records]);

  const maxTotal = byCategory.length > 0 ? byCategory[0][1].total : 1;

  if (records.length === 0) {
    return (
      <Card size="sm" className="border-white/[0.08]">
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          {t("service.stats.noData") as string}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Card size="sm" className="border-white/[0.08]">
          <CardContent className="p-3 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {t("service.stats.totalSpent") as string}
            </p>
            <p className="mt-1 text-lg font-bold text-[var(--voltflow-green)]">
              {formatCurrencyAmount(currency, totalSpent, locale)}
            </p>
          </CardContent>
        </Card>
        <Card size="sm" className="border-white/[0.08]">
          <CardContent className="p-3 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {t("service.stats.thisYear") as string}
            </p>
            <p className="mt-1 text-lg font-bold">
              {formatCurrencyAmount(currency, thisYear, locale)}
            </p>
          </CardContent>
        </Card>
        <Card size="sm" className="border-white/[0.08]">
          <CardContent className="p-3 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {t("service.stats.avgCost") as string}
            </p>
            <p className="mt-1 text-lg font-bold">
              {formatCurrencyAmount(currency, avgCost, locale)}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card size="sm" className="border-white/[0.08]">
        <CardHeader>
          <CardTitle className="text-xs font-semibold text-muted-foreground">
            {t("service.stats.byCategory") as string}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {byCategory.map(([cat, { count, total }]) => {
            const bar = categoryBarColor(cat, userCatMap);
            return (
              <div key={cat}>
                <div className="mb-1 flex justify-between text-xs">
                  <span>
                    {(BUILT_IN_SERVICE_CATEGORIES as readonly string[]).includes(cat)
                      ? (t(`service.category.${cat}` as TranslationKey) as string) || cat
                      : cat}
                  </span>
                  <span className="text-muted-foreground">
                    {t("service.stats.count", { count })}
                    {" · "}
                    {formatCurrencyAmount(currency, total, locale)}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-white/[0.06]">
                  <div
                    className={bar.className ? `h-full rounded-full ${bar.className}` : "h-full rounded-full"}
                    style={{ width: `${(total / maxTotal) * 100}%`, ...bar.style }}
                  />
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
