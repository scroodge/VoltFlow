"use client";

import { useMemo, useState } from "react";

import { ArticleCard } from "@/components/telegram/ArticleCard";
import { SearchBox } from "@/components/telegram/SearchBox";
import { SectionHeader } from "@/components/telegram/ChargingGuides";
import { maintenanceArticles } from "@/data/telegram/maintenance";
import type { KnowledgeArticle } from "@/types/telegram";

export function MaintenanceGuides({ articles: providedArticles }: { articles?: KnowledgeArticle[] }) {
  const [query, setQuery] = useState("");
  const sourceArticles = providedArticles ?? maintenanceArticles;
  const articles = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) return sourceArticles;

    return sourceArticles.filter((article) =>
      [article.title, article.summary, article.tags.join(" "), article.sections.map((section) => section.body).join(" ")]
        .join(" ")
        .toLowerCase()
        .includes(value),
    );
  }, [query, sourceArticles]);

  return (
    <section className="space-y-4" aria-labelledby="maintenance-title">
      <SectionHeader
        eyebrow="Обслуживание"
        title="Безопасные проверки и подготовка к сервису"
        description="Проверки уровня владельца, симптомы, сервисные заметки и границы безопасности."
        id="maintenance-title"
      />
      <SearchBox value={query} onChange={setQuery} placeholder="Искать по обслуживанию" />
      <div className="space-y-3">
        {articles.map((article, index) => (
          <ArticleCard key={article.id} article={article} priorityImage={index === 0} />
        ))}
      </div>
    </section>
  );
}
