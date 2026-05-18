"use client";

import { useMemo, useState } from "react";

import { ArticleCard } from "@/components/telegram/ArticleCard";
import { SearchBox } from "@/components/telegram/SearchBox";
import type { KnowledgeArticle } from "@/types/telegram";

export function ArticleList({
  articles,
  placeholder = "Искать статьи",
  title = "Статьи базы знаний",
  eyebrow = "Все гайды",
}: {
  articles: KnowledgeArticle[];
  placeholder?: string;
  title?: string;
  eyebrow?: string;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) return articles;

    return articles.filter((article) =>
      [
        article.title,
        article.summary,
        article.tags.join(" "),
        article.sections.map((section) => `${section.heading} ${section.body}`).join(" "),
      ]
        .join(" ")
        .toLowerCase()
        .includes(value),
    );
  }, [articles, query]);

  return (
    <section className="space-y-4" aria-labelledby="all-guides-title">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--voltflow-cyan)]">
          {eyebrow}
        </p>
        <h2 id="all-guides-title" className="mt-1 font-heading text-2xl font-bold">
          {title}
        </h2>
      </div>
      <SearchBox value={query} onChange={setQuery} placeholder={placeholder} />
      <div className="space-y-3">
        {filtered.map((article, index) => (
          <ArticleCard key={article.id} article={article} priorityImage={index === 0} />
        ))}
      </div>
    </section>
  );
}
