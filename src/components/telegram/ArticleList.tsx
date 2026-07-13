"use client";

import { ArticleCard } from "@/components/telegram/ArticleCard";
import { SearchBox } from "@/components/telegram/SearchBox";
import { SemanticSearchResults } from "@/components/telegram/SemanticSearchResults";
import { useSemanticKnowledgeSearch } from "@/hooks/use-semantic-knowledge-search";
import type { CarGeneration } from "@/lib/car-generations";
import type { KnowledgeArticle } from "@/types/telegram";

export function ArticleList({
  articles,
  generation,
  semanticCategory,
  // Say what the box actually searches. It is the same semantic engine as the home
  // search, but scoped to articles (and to one category when one is picked) — an
  // unlabelled box gives no cue why the same query returns different results here.
  placeholder = "Поиск по всем статьям",
  title = "Статьи базы знаний",
  eyebrow = "Все гайды",
}: {
  articles: KnowledgeArticle[];
  generation: CarGeneration;
  semanticCategory?: string | null;
  placeholder?: string;
  title?: string;
  eyebrow?: string;
}) {
  const search = useSemanticKnowledgeSearch({
    category: semanticCategory,
    generation,
    limit: 8,
    sourceTypes: ["article"],
  });

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
      <SearchBox
        value={search.query}
        onChange={search.search}
        placeholder={placeholder}
        debounceMs={350}
      />
      {search.trimmedQuery ? (
        <SemanticSearchResults
          error={search.error}
          isLoading={search.isSearching}
          query={search.trimmedQuery}
          results={search.results}
          title="Найденные статьи"
        />
      ) : (
        <div className="space-y-3">
          {articles.map((article, index) => (
            <ArticleCard key={article.id} article={article} priorityImage={index === 0} />
          ))}
        </div>
      )}
    </section>
  );
}
