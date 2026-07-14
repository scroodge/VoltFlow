"use client";

import { Loader2, SearchX } from "lucide-react";
import Link from "next/link";

import { classifySearchConfidence } from "@/lib/knowledge-search-confidence";
import type { KnowledgeSearchResult } from "@/lib/knowledge-search";
import { cn } from "@/lib/utils";

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

  // The corpus is small and will always have gaps. When nothing clearly answers the
  // question, say so instead of presenting the least-unrelated item as an answer — a query
  // like "как заряжать зимой" (no such article exists) used to return winter *washer fluid*
  // at 42% dressed up exactly like a real hit.
  const { confident } = classifySearchConfidence(results);

  return (
    <section className="space-y-3" aria-label={confident ? title : "Похожие материалы"}>
      {confident ? (
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--voltflow-cyan)]">
          {title}
        </p>
      ) : (
        <>
          <div className="voltflow-card flex gap-3 p-4">
            <SearchX
              className="mt-0.5 size-5 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <div>
              <p className="font-heading text-sm font-bold">
                Точного ответа не нашлось
              </p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                В базе знаний пока нет материала по запросу «{query}». Попробуйте
                переформулировать или загляните в разделы.
              </p>
            </div>
          </div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">
            Возможно, близкое
          </p>
        </>
      )}
      {results.map((result) => {
        const card = (
          <>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p
                  className={cn(
                    "text-xs font-bold uppercase tracking-[0.14em]",
                    confident
                      ? "text-[var(--voltflow-green)]"
                      : "text-muted-foreground",
                  )}
                >
                  {categoryLabel(result.category)}
                </p>
                <h3 className="mt-1 font-heading text-base font-bold">{result.title}</h3>
              </div>
              {/* A weak match must not wear the same confident green badge as a real hit. */}
              <span
                className={cn(
                  "shrink-0 rounded-full border px-2.5 py-1 text-xs font-bold",
                  confident
                    ? "border-[var(--voltflow-green)]/40 bg-[var(--voltflow-green)]/10 text-[var(--voltflow-green)]"
                    : "border-border bg-white/[0.04] text-muted-foreground",
                )}
              >
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

        const internalHref = getInternalResultHref(result);
        const externalHref = isExternalHref(result.source_url) ? result.source_url : null;

        if (internalHref) {
          return (
            <Link
              key={result.id}
              href={internalHref}
              className="voltflow-card block p-4 transition hover:border-[var(--voltflow-cyan)]/60 focus-visible:ring-3 focus-visible:ring-[var(--voltflow-cyan)]/30"
            >
              {card}
            </Link>
          );
        }

        if (externalHref) {
          return (
            <a
              key={result.id}
              href={externalHref}
              target="_blank"
              rel="noreferrer"
              className="voltflow-card block p-4 transition hover:border-[var(--voltflow-cyan)]/60 focus-visible:ring-3 focus-visible:ring-[var(--voltflow-cyan)]/30"
            >
              {card}
            </a>
          );
        }

        const catalogHref = getCatalogResultHref(result);
        if (catalogHref) {
          return (
            <Link
              key={result.id}
              href={catalogHref}
              className="voltflow-card block p-4 transition hover:border-[var(--voltflow-cyan)]/60 focus-visible:ring-3 focus-visible:ring-[var(--voltflow-cyan)]/30"
            >
              {card}
            </Link>
          );
        }

        return (
          <article key={result.id} className="voltflow-card p-4">
            {card}
          </article>
        );
      })}
    </section>
  );
}

function getInternalResultHref(result: KnowledgeSearchResult) {
  if (result.source_url?.startsWith("/")) return result.source_url;
  if (result.source_type === "faq") return "/telegram?tab=faq";
  return null;
}

function getCatalogResultHref(result: KnowledgeSearchResult) {
  if (result.source_type === "accessory" || result.source_type === "spare_part") {
    return "/telegram?tab=buy";
  }
  return null;
}

function isExternalHref(value: string | null) {
  return Boolean(value && /^https?:\/\//i.test(value));
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
