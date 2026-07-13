"use client";

import { useCallback, useMemo, useState } from "react";

import { ArticleList } from "@/components/telegram/ArticleList";
import { BuyCatalog } from "@/components/telegram/BuyCatalog";
import { Calculators } from "@/components/telegram/Calculators";
import { CategoryFilter } from "@/components/telegram/CategoryFilter";
import { KnowledgeHome } from "@/components/telegram/KnowledgeHome";
import { SmartFAQ } from "@/components/telegram/SmartFAQ";
import type { TelegramTab } from "@/components/telegram/BottomTabs";
import type { CarGeneration } from "@/lib/car-generations";
import {
  filterArticlesByGeneration,
  normalizeModelGenerations,
} from "@/lib/telegram/generation";
import { useTelegramWebApp } from "@/lib/telegram/useTelegramWebApp";
import type { TelegramKnowledgeData } from "@/types/knowledge";
import { cn } from "@/lib/utils";

type KnowledgeViewProps = {
  data?: TelegramKnowledgeData;
  generation: CarGeneration;
  activeTab: TelegramTab;
  onTabChange: (tab: TelegramTab) => void;
};

export function KnowledgeView({ data, generation, activeTab, onTabChange }: KnowledgeViewProps) {
  const [guideCategory, setGuideCategory] = useState<string | "All">("All");
  const telegram = useTelegramWebApp();

  const filteredArticles = useMemo(
    () => filterArticlesByGeneration(data?.articles ?? [], generation),
    [data?.articles, generation],
  );

  /**
   * One taxonomy, derived from the articles actually on screen, feeding *both* the home
   * tiles and the guides chips. These used to be two hand-written lists that had already
   * drifted apart: "Эксплуатация" was a home card with no matching chip, and "Батарея"
   * was a chip with no card.
   */
  const articleCategories = useMemo(() => {
    const bySlug = new Map<string, { slug: string; title: string; count: number }>();
    for (const article of filteredArticles) {
      const existing = bySlug.get(article.categorySlug);
      if (existing) {
        existing.count += 1;
      } else {
        bySlug.set(article.categorySlug, {
          slug: article.categorySlug,
          title: article.category,
          count: 1,
        });
      }
    }
    return Array.from(bySlug.values()).sort((a, b) => b.count - a.count);
  }, [filteredArticles]);

  /** A section tile must land you *in* that section, not on an unfiltered list. */
  const openCategory = useCallback(
    (slug: string) => {
      setGuideCategory(slug);
      onTabChange("guides");
    },
    [onTabChange],
  );
  const filteredAccessories = useMemo(
    () => filterArticlesByGeneration(data?.accessories ?? [], generation),
    [data?.accessories, generation],
  );
  const filteredSpareParts = useMemo(
    () =>
      (data?.spareParts ?? []).filter((item) =>
        normalizeModelGenerations(item.model_generations).includes(generation),
      ),
    [data?.spareParts, generation],
  );

  const filteredData = useMemo(
    () =>
      data
        ? {
            ...data,
            articles: filteredArticles,
            accessories: filteredAccessories,
            spareParts: filteredSpareParts,
          }
        : undefined,
    [data, filteredAccessories, filteredArticles, filteredSpareParts],
  );

  return (
    <div className={cn(telegram.isTelegram && "telegram-webview")}>
      <div className="mt-3">
        {activeTab === "home" ? (
          <KnowledgeHome
            key={generation}
            generation={generation}
            categories={articleCategories}
            onOpenCategory={openCategory}
            data={filteredData}
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
              <ArticleList articles={filteredArticles} generation={generation} />
            ) : null}
            {guideCategory !== "All" ? (
              (() => {
                const active = articleCategories.find(
                  (category) => category.slug === guideCategory,
                );
                return (
                  <ArticleList
                    articles={filteredArticles.filter(
                      (article) => article.categorySlug === guideCategory,
                    )}
                    generation={generation}
                    semanticCategory={guideCategory}
                    eyebrow={active?.title ?? "Гайды"}
                    title="Статьи раздела"
                    placeholder={
                      active
                        ? `Поиск в разделе «${active.title}»`
                        : "Поиск по всем статьям"
                    }
                  />
                );
              })()
            ) : null}
            {!filteredArticles.length ? (
              <p className="text-sm leading-6 text-muted-foreground">
                Для выбранного поколения статей пока нет. Попробуйте другое поколение или
                загляните позже.
              </p>
            ) : null}
          </div>
        ) : null}
        {activeTab === "faq" ? <SmartFAQ generation={generation} items={data?.faq} /> : null}
        {activeTab === "buy" ? (
          <BuyCatalog
            accessories={data?.accessories}
            generation={generation}
            spareParts={data?.spareParts}
          />
        ) : null}
        {activeTab === "more" ? <Calculators /> : null}
      </div>
    </div>
  );
}

export type { TelegramTab };
