"use client";

import { useMemo, useState } from "react";

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

  const articleCategories = useMemo(() => {
    const categoryMap = new Map<string, string>();
    for (const article of data?.articles ?? []) {
      categoryMap.set(article.categorySlug, article.category);
    }
    return Array.from(categoryMap.entries()).map(([slug, title]) => ({ slug, title }));
  }, [data?.articles]);

  const filteredArticles = useMemo(
    () => filterArticlesByGeneration(data?.articles ?? [], generation),
    [data?.articles, generation],
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
            isTelegram={telegram.isTelegram}
            onNavigate={onTabChange}
            generation={generation}
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
              <ArticleList
                articles={filteredArticles.filter(
                  (article) => article.categorySlug === guideCategory,
                )}
                generation={generation}
                semanticCategory={guideCategory}
                eyebrow={
                  articleCategories.find((category) => category.slug === guideCategory)
                    ?.title ?? "Гайды"
                }
                title="Статьи раздела"
              />
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
  );
}

export type { TelegramTab };
