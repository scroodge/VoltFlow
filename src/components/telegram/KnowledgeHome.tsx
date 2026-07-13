"use client";

import { Clock, Library } from "lucide-react";

import { useSemanticKnowledgeSearch } from "@/hooks/use-semantic-knowledge-search";
import type { CarGeneration } from "@/lib/car-generations";
import { ArticleCard } from "@/components/telegram/ArticleCard";
import { SearchBox } from "@/components/telegram/SearchBox";
import { SemanticSearchResults } from "@/components/telegram/SemanticSearchResults";
import type { TelegramKnowledgeData } from "@/types/knowledge";

export type KnowledgeCategoryTile = {
  slug: string;
  title: string;
  count: number;
};

type KnowledgeHomeProps = {
  generation: CarGeneration;
  /** Real categories from the data, with how many articles each holds. */
  categories: KnowledgeCategoryTile[];
  /** Opens the Guides tab *already filtered* to this category. */
  onOpenCategory: (slug: string) => void;
  data?: Pick<TelegramKnowledgeData, "articles" | "faq" | "accessories">;
};

function pluralArticles(count: number) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "статья";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "статьи";
  return "статей";
}

/**
 * Newest-first by `updatedAt` (an ISO date the DB mapper fills from
 * `articles.updated_at`). Replaces a "Популярные статьи" list that was really the first
 * four *charging* articles in insertion order — no popularity signal exists in the data,
 * so that label promised something it could not deliver.
 */
function recentlyUpdated(
  articles: TelegramKnowledgeData["articles"] | undefined,
  limit: number,
) {
  return [...(articles ?? [])]
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))
    .slice(0, limit);
}

export function KnowledgeHome({
  generation,
  categories,
  onOpenCategory,
  data,
}: KnowledgeHomeProps) {
  const search = useSemanticKnowledgeSearch({
    generation,
    limit: 6,
    sourceTypes: ["article", "faq", "accessory", "spare_part"],
  });

  const recent = recentlyUpdated(data?.articles, 4);

  return (
    <section className="space-y-4" aria-labelledby="knowledge-home-title">
      <div className="space-y-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--voltflow-cyan)]">
          VoltFlow
        </p>
        <h1
          id="knowledge-home-title"
          className="font-heading text-2xl font-bold leading-tight"
        >
          База знаний
        </h1>
        <p className="text-sm leading-5 text-muted-foreground">
          Спросите своими словами — или выберите раздел ниже.
        </p>
      </div>

      <SearchBox
        value={search.query}
        onChange={search.search}
        placeholder="Например: как заряжать зимой, коврики, медленно заряжается"
        debounceMs={350}
      />

      {search.trimmedQuery ? (
        <SemanticSearchResults
          error={search.error}
          isLoading={search.isSearching}
          query={search.trimmedQuery}
          results={search.results}
        />
      ) : null}

      {categories.length ? (
        <section className="space-y-2.5" aria-labelledby="sections-title">
          <div className="flex items-center gap-2">
            <Library className="size-4 text-[var(--voltflow-cyan)]" aria-hidden />
            <h2 id="sections-title" className="font-heading text-base font-bold">
              Разделы
            </h2>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {categories.map(({ slug, title, count }) => (
              <button
                key={slug}
                type="button"
                onClick={() => onOpenCategory(slug)}
                className="voltflow-card flex min-h-16 flex-col justify-center gap-1 p-3 text-left transition hover:border-[var(--voltflow-cyan)]/60"
              >
                <span className="font-heading text-sm font-bold leading-tight">
                  {title}
                </span>
                {/* The count is the cheapest trust signal available: it says whether the
                    section is worth a tap before you spend one. */}
                <span className="text-xs text-muted-foreground">
                  {count} {pluralArticles(count)}
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {recent.length ? (
        <section className="space-y-2.5" aria-labelledby="recent-title">
          <div className="flex items-center gap-2">
            <Clock className="size-4 text-[var(--voltflow-cyan)]" aria-hidden />
            <h2 id="recent-title" className="font-heading text-base font-bold">
              Недавно обновленные
            </h2>
          </div>
          {recent.map((article, index) => (
            <ArticleCard
              key={article.id}
              article={article}
              priorityImage={index === 0}
            />
          ))}
        </section>
      ) : null}
    </section>
  );
}
