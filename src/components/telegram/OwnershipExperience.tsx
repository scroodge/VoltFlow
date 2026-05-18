"use client";

import { useMemo, useState } from "react";

import { ArticleCard } from "@/components/telegram/ArticleCard";
import { SearchBox } from "@/components/telegram/SearchBox";
import { SectionHeader } from "@/components/telegram/ChargingGuides";
import { ownershipExperienceArticles } from "@/data/telegram/ownership-experience";
import type { KnowledgeArticle } from "@/types/telegram";

export function OwnershipExperience({ articles: providedArticles }: { articles?: KnowledgeArticle[] }) {
  const [query, setQuery] = useState("");
  const sourceArticles = providedArticles ?? ownershipExperienceArticles;
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
    <section className="space-y-4" aria-labelledby="ownership-title">
      <SectionHeader
        eyebrow="Опыт эксплуатации"
        title="Практичные заметки владельца"
        description="Привычки, комфорт, расход, поездки, первые настройки и типичные ошибки новичка."
        id="ownership-title"
      />
      <SearchBox value={query} onChange={setQuery} placeholder="Искать по эксплуатации" />
      <div className="space-y-3">
        {articles.map((article, index) => (
          <ArticleCard key={article.id} article={article} priorityImage={index === 0} />
        ))}
      </div>
    </section>
  );
}
