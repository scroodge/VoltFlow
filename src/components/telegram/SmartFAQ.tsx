"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { CategoryFilter } from "@/components/telegram/CategoryFilter";
import { SearchBox } from "@/components/telegram/SearchBox";
import { SemanticSearchResults } from "@/components/telegram/SemanticSearchResults";
import { faqCategories } from "@/data/telegram/categories";
import { faqItems } from "@/data/telegram/faq";
import { useSemanticKnowledgeSearch } from "@/hooks/use-semantic-knowledge-search";
import type { CarGeneration } from "@/lib/car-generations";
import { cn } from "@/lib/utils";
import type { FAQItem } from "@/types/telegram";

type FaqCategory = (typeof faqCategories)[number];
type FaqFilter = "All" | FaqCategory;

const faqCategorySlugs: Record<FaqCategory, string> = {
  "BYD Yuan Up": "byd-yuan-up",
  "Аксессуары": "accessories",
  "Батарея": "battery",
  "Безопасность": "safety",
  "Зарядка": "charging",
  "Зима": "winter",
  "Обслуживание": "maintenance",
  "Расходы": "costs",
  "Эксплуатация": "ownership",
};

export function SmartFAQ({
  generation,
  items: providedItems,
}: {
  generation: CarGeneration;
  items?: FAQItem[];
}) {
  const searchParams = useSearchParams();
  const sourceItems = providedItems ?? faqItems;
  const [category, setCategory] = useState<FaqFilter>("All");
  const [openQuestion, setOpenQuestion] = useState(sourceItems[0]?.question ?? "");
  const {
    error,
    isSearching,
    query,
    results,
    search,
    trimmedQuery,
  } = useSemanticKnowledgeSearch({
    category: category === "All" ? null : faqCategorySlugs[category],
    generation,
    limit: 8,
    sourceTypes: ["faq"],
  });

  const filteredItems = useMemo(() => {
    return sourceItems.filter((item) => {
      const matchesCategory = category === "All" || item.category === category;
      return matchesCategory;
    });
  }, [category, sourceItems]);

  useEffect(() => {
    const q = searchParams.get("q");
    if (q) {
      window.setTimeout(() => {
        search(q);
        setOpenQuestion(q);
      }, 0);
    }
  }, [search, searchParams]);

  return (
    <section className="space-y-4" aria-labelledby="telegram-faq-title">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--voltflow-cyan)]">
          Вопросы и ответы
        </p>
        <h2 id="telegram-faq-title" className="mt-1 font-heading text-2xl font-bold">
          Ответы для ежедневной эксплуатации
        </h2>
      </div>

      <SearchBox
        value={query}
        onChange={search}
        placeholder="Искать вопрос, ответ или тег"
        debounceMs={350}
      />

      <CategoryFilter
        categories={faqCategories}
        activeCategory={category}
        onChange={setCategory}
      />

      {trimmedQuery ? (
        <SemanticSearchResults
          error={error}
          isLoading={isSearching}
          query={trimmedQuery}
          results={results}
          title="Найденные вопросы"
        />
      ) : (
        <div className="space-y-3">
          {filteredItems.map((item) => {
          const isOpen = openQuestion === item.question;

          return (
            <article key={item.question} className="voltflow-card overflow-hidden">
              <button
                type="button"
                onClick={() => setOpenQuestion(isOpen ? "" : item.question)}
                className="flex w-full items-start justify-between gap-4 p-4 text-left"
                aria-expanded={isOpen}
              >
                <span>
                  <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--voltflow-green)]">
                    {item.category}
                  </span>
                  <span className="mt-1 block font-heading text-base font-bold leading-snug">
                    {item.question}
                  </span>
                </span>
                <ChevronDown
                  className={cn(
                    "mt-1 size-5 shrink-0 text-muted-foreground transition",
                    isOpen && "rotate-180 text-[var(--voltflow-cyan)]",
                  )}
                  aria-hidden
                />
              </button>
              {isOpen ? (
                <div className="border-t border-border/80 px-4 pb-4 pt-3 text-sm leading-6 text-muted-foreground">
                  {item.answer}
                  {item.relatedIds?.length ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {item.relatedIds.map((id) => (
                        <Link
                          key={id}
                          href={`/telegram/article/${id}`}
                          className="rounded-full border border-border bg-white/[0.03] px-3 py-1 text-xs font-semibold text-[var(--voltflow-cyan)]"
                        >
                          {id}
                        </Link>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </article>
          );
          })}
        </div>
      )}

      {!trimmedQuery && filteredItems.length === 0 ? (
        <div className="voltflow-card p-4 text-sm leading-6 text-muted-foreground">
          Подходящих вопросов пока нет. Попробуйте более короткий запрос или другой раздел.
        </div>
      ) : null}
    </section>
  );
}
