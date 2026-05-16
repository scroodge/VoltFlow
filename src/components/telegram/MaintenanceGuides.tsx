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
        eyebrow="Repair and Maintenance"
        title="Safe maintenance and service preparation"
        description="Owner-level checks, service notes, symptoms, and safety boundaries."
        id="maintenance-title"
      />
      <SearchBox value={query} onChange={setQuery} placeholder="Search maintenance guides" />
      <div className="space-y-3">
        {articles.map((article) => (
          <ArticleCard key={article.id} article={article} />
        ))}
      </div>
    </section>
  );
}
