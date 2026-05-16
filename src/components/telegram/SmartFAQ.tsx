"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { CategoryFilter } from "@/components/telegram/CategoryFilter";
import { SearchBox } from "@/components/telegram/SearchBox";
import { faqCategories } from "@/data/telegram/categories";
import { faqItems } from "@/data/telegram/faq";
import { cn } from "@/lib/utils";
import type { FAQItem } from "@/types/telegram";

type FaqCategory = (typeof faqCategories)[number];
type FaqFilter = "All" | FaqCategory;

export function SmartFAQ({ items: providedItems }: { items?: FAQItem[] }) {
  const searchParams = useSearchParams();
  const sourceItems = providedItems ?? faqItems;
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<FaqFilter>("All");
  const [openQuestion, setOpenQuestion] = useState(sourceItems[0]?.question ?? "");

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return sourceItems.filter((item) => {
      const matchesCategory = category === "All" || item.category === category;
      const matchesQuery =
        normalizedQuery.length === 0 ||
        item.question.toLowerCase().includes(normalizedQuery) ||
        item.answer.toLowerCase().includes(normalizedQuery) ||
        item.category.toLowerCase().includes(normalizedQuery) ||
        item.tags.join(" ").toLowerCase().includes(normalizedQuery);

      return matchesCategory && matchesQuery;
    });
  }, [category, query, sourceItems]);

  useEffect(() => {
    const q = searchParams.get("q");
    if (q) {
      window.setTimeout(() => {
        setQuery(q);
        setOpenQuestion(q);
      }, 0);
    }
  }, [searchParams]);

  return (
    <section className="space-y-4" aria-labelledby="telegram-faq-title">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--voltflow-cyan)]">
          Smart FAQ
        </p>
        <h2 id="telegram-faq-title" className="mt-1 font-heading text-2xl font-bold">
          Answers for everyday charging
        </h2>
      </div>

      <SearchBox
        value={query}
        onChange={setQuery}
        placeholder="Search FAQ by topic, answer, or tag"
      />

      <CategoryFilter
        categories={faqCategories}
        activeCategory={category}
        onChange={setCategory}
      />

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

      {filteredItems.length === 0 ? (
        <div className="voltflow-card p-4 text-sm leading-6 text-muted-foreground">
          No matching FAQ yet. Try a shorter search or another category.
        </div>
      ) : null}
    </section>
  );
}
