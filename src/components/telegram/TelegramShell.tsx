"use client";

import { BatteryCharging, RadioTower, UserCircle2, Zap } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { BottomTabs, type TelegramTab } from "@/components/telegram/BottomTabs";
import { ArticleList } from "@/components/telegram/ArticleList";
import { BuyCatalog } from "@/components/telegram/BuyCatalog";
import { Calculators } from "@/components/telegram/Calculators";
import { CategoryFilter } from "@/components/telegram/CategoryFilter";
import { KnowledgeHome } from "@/components/telegram/KnowledgeHome";
import { SmartFAQ } from "@/components/telegram/SmartFAQ";
import { getTelegramThemeStyle } from "@/lib/telegram/theme";
import { useTelegramWebApp } from "@/lib/telegram/useTelegramWebApp";
import type { TelegramKnowledgeData } from "@/types/knowledge";

export function TelegramShell({ data }: { data?: TelegramKnowledgeData }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<TelegramTab>("home");
  const [guideCategory, setGuideCategory] = useState<string | "All">("All");
  const articleCategories = useMemo(() => {
    const categoryMap = new Map<string, string>();
    for (const article of data?.articles ?? []) {
      categoryMap.set(article.categorySlug, article.category);
    }
    return Array.from(categoryMap.entries()).map(([slug, title]) => ({ slug, title }));
  }, [data?.articles]);
  const telegram = useTelegramWebApp();
  const themeStyle = useMemo(
    () => getTelegramThemeStyle(telegram.themeParams),
    [telegram.themeParams],
  );
  const userName =
    telegram.user?.first_name ||
    telegram.user?.username ||
    (telegram.isTelegram ? "Пользователь Telegram" : "Веб-пользователь");

  useEffect(() => {
    const tab = searchParams.get("tab") as TelegramTab | null;
    window.setTimeout(() => {
      if (tab && ["home", "guides", "faq", "buy", "more"].includes(tab)) {
        setActiveTab(tab);
      } else {
        setActiveTab("home");
      }
    }, 0);
  }, [searchParams]);

  function changeTab(tab: TelegramTab) {
    setActiveTab(tab);
    const params = new URLSearchParams(searchParams);
    if (tab === "home") {
      params.delete("tab");
    } else {
      params.set("tab", tab);
    }
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return (
    <main
      className="relative isolate min-h-dvh overflow-x-hidden scroll-smooth bg-background text-foreground"
      style={themeStyle}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_-8%,rgba(0,209,255,0.24),transparent_26rem),radial-gradient(circle_at_8%_18%,rgba(0,230,118,0.14),transparent_20rem),linear-gradient(180deg,rgba(18,21,28,0)_0%,#12151C_78%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px voltflow-gradient" />

      <div className="mobile-page relative min-h-dvh px-4 pb-[calc(env(safe-area-inset-bottom)+7.5rem)] pt-[calc(env(safe-area-inset-top)+1rem)]">
        <header className="sticky top-0 z-30 -mx-4 space-y-4 border-b border-border/60 bg-background/88 px-4 pb-4 pt-[calc(env(safe-area-inset-top)+1rem)] backdrop-blur-xl">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="grid size-11 shrink-0 place-items-center rounded-lg border border-[var(--voltflow-green)]/30 bg-[var(--voltflow-green)]/10 text-[var(--voltflow-green)]">
                <Zap className="size-6" aria-hidden />
              </div>
              <div>
                <h1 className="font-heading text-2xl font-bold leading-none">
                  VoltFlow
                </h1>
                <p className="mt-1 text-sm font-semibold text-muted-foreground">
                  EV-помощник
                </p>
              </div>
            </div>

            <span className="shrink-0 rounded-full border border-border bg-white/[0.04] px-3 py-1.5 text-xs font-bold text-[var(--voltflow-cyan)]">
              {telegram.isTelegram ? "Мини-приложение Telegram" : "Веб-режим"}
            </span>
          </div>

          <section className="voltflow-card p-4" aria-label="Mini app status">
            <div className="grid grid-cols-[1fr_auto] gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <UserCircle2 className="size-4" aria-hidden />
                  <span className="truncate">{userName}</span>
                </p>
                <p className="mt-2 font-heading text-xl font-bold">
                  Заряжайтесь спокойнее
                </p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Русская база знаний: зарядка, эксплуатация, обслуживание,
                  аксессуары, вопросы и калькуляторы.
                </p>
              </div>
              <div className="grid size-14 place-items-center rounded-lg border border-border bg-white/[0.04] text-[var(--voltflow-green)]">
                {telegram.isTelegram ? (
                  <RadioTower className="size-7" aria-hidden />
                ) : (
                  <BatteryCharging className="size-7" aria-hidden />
                )}
              </div>
            </div>
          </section>
        </header>

        <div className="mt-5">
          {activeTab === "home" ? (
              <KnowledgeHome
              isTelegram={telegram.isTelegram}
              onNavigate={changeTab}
              data={data}
            />
          ) : null}
          {activeTab === "guides" ? (
            <div className="space-y-4">
              <CategoryFilter
                categories={articleCategories.map((category) => category.slug)}
                activeCategory={guideCategory}
                onChange={setGuideCategory}
                labels={Object.fromEntries(
                  articleCategories.map((category) => [category.slug, category.title]),
                )}
              />
              {guideCategory === "All" ? (
                <ArticleList articles={data?.articles ?? []} />
              ) : null}
              {guideCategory !== "All" ? (
                <ArticleList
                  articles={(data?.articles ?? []).filter((article) => article.categorySlug === guideCategory)}
                  eyebrow={articleCategories.find((category) => category.slug === guideCategory)?.title ?? "Гайды"}
                  title="Статьи раздела"
                />
              ) : null}
            </div>
          ) : null}
          {activeTab === "faq" ? <SmartFAQ items={data?.faq} /> : null}
          {activeTab === "buy" ? (
            <BuyCatalog accessories={data?.accessories} spareParts={data?.spareParts} />
          ) : null}
          {activeTab === "more" ? (
            <div className="space-y-5">
              <Calculators />
              <div className="voltflow-card p-4 text-sm leading-6 text-muted-foreground">
                Следующие фазы пока намеренно не включены: импорт из Telegram,
                семантический поиск, AI-помощник, embeddings, аналитика и
                дополнительные интеграции VoltFlow.
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <BottomTabs activeTab={activeTab} onTabChange={changeTab} />
    </main>
  );
}
