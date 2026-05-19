"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";

import type { KnowledgeSearchResult } from "@/lib/knowledge-search";

export function SemanticSearchResults({
  emptyText,
  error,
  isLoading,
  query,
  results,
  title = "Умный поиск",
}: {
  emptyText?: string;
  error: string | null;
  isLoading: boolean;
  query: string;
  results: KnowledgeSearchResult[];
  title?: string;
}) {
  if (isLoading) {
    return (
      <div className="voltflow-card flex items-center gap-3 p-4 text-sm font-semibold text-muted-foreground">
        <Loader2 className="size-5 animate-spin text-[var(--voltflow-cyan)]" aria-hidden />
        Ищем по смыслу...
      </div>
    );
  }

  if (error) {
    return <div className="voltflow-card p-4 text-sm leading-6 text-muted-foreground">{error}</div>;
  }

  if (!results.length) {
    return (
      <div className="voltflow-card p-4 text-sm leading-6 text-muted-foreground">
        {emptyText ?? `Ничего не найдено для «${query}». Попробуйте переформулировать вопрос.`}
      </div>
    );
  }

  return (
    <section className="space-y-3" aria-label={title}>
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--voltflow-cyan)]">
        {title}
      </p>
      {results.map((result) => {
        const card = (
          <>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--voltflow-green)]">
                  {categoryLabel(result.category)}
                </p>
                <h3 className="mt-1 font-heading text-base font-bold">{result.title}</h3>
              </div>
              <span className="shrink-0 rounded-full border border-[var(--voltflow-green)]/40 bg-[var(--voltflow-green)]/10 px-2.5 py-1 text-xs font-bold text-[var(--voltflow-green)]">
                {Math.round(result.similarity * 100)}%
              </span>
            </div>
            <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted-foreground">
              {result.content}
            </p>
            {result.tags.length ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {result.tags.slice(0, 4).map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-border bg-white/[0.04] px-2.5 py-1 text-xs font-semibold text-muted-foreground"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            ) : null}
          </>
        );

        return result.source_url?.startsWith("/") ? (
          <Link
            key={result.id}
            href={result.source_url}
            className="voltflow-card block p-4 transition hover:border-[var(--voltflow-cyan)]/60 focus-visible:ring-3 focus-visible:ring-[var(--voltflow-cyan)]/30"
          >
            {card}
          </Link>
        ) : (
          <article key={result.id} className="voltflow-card p-4">
            {card}
          </article>
        );
      })}
    </section>
  );
}

function categoryLabel(category: string) {
  const labels: Record<string, string> = {
    accessories: "Аксессуары",
    battery: "Батарея",
    charging: "Зарядка",
    faq: "FAQ",
    maintenance: "Обслуживание",
    ownership: "Эксплуатация",
    "spare-parts": "Запчасти",
    winter: "Зима",
  };

  return labels[category] ?? category;
}
