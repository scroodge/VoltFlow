"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { AccessoryCard } from "@/components/telegram/ArticleCard";
import { GenerationFilter } from "@/components/telegram/GenerationFilter";
import { GenerationFilteredArticles } from "@/components/telegram/GenerationFilteredArticles";
import { SparePartsCatalog } from "@/components/telegram/SparePartsCatalog";
import { useAutoDetectCarGeneration } from "@/hooks/use-auto-detect-car-generation";
import { useTelegramGeneration } from "@/hooks/use-telegram-generation";
import {
  filterArticlesByGeneration,
  normalizeModelGenerations,
} from "@/lib/telegram/generation";
import type { SparePartItem } from "@/types/knowledge";
import type { AccessoryItem, FAQItem, KnowledgeArticle } from "@/types/telegram";

type TelegramCategoryViewProps = {
  category: {
    slug: string;
    title: string;
    description: string;
  };
  content: {
    articles: KnowledgeArticle[];
    faq: FAQItem[];
    accessories: AccessoryItem[];
    spareParts: SparePartItem[];
  };
};

export function TelegramCategoryView({ category, content }: TelegramCategoryViewProps) {
  const [generation, setGeneration] = useTelegramGeneration();
  const searchParams = useSearchParams();
  useAutoDetectCarGeneration(setGeneration, searchParams.get("gen"));
  const accessories = filterArticlesByGeneration(content.accessories, generation);
  const spareParts = content.spareParts.filter((item) =>
    normalizeModelGenerations(item.model_generations).includes(generation),
  );

  return (
    <>
      <Link
        href={`/telegram?gen=${generation}`}
        className="inline-flex min-h-11 items-center rounded-lg border border-border bg-white/[0.04] px-4 text-sm font-semibold text-muted-foreground"
      >
        На главную
      </Link>

      <header className="voltflow-card p-5">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--voltflow-cyan)]">
          Раздел
        </p>
        <h1 className="mt-2 font-heading text-3xl font-bold">{category.title}</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{category.description}</p>
        <div className="mt-4">
          <GenerationFilter value={generation} onChange={setGeneration} />
        </div>
      </header>

      {content.articles.length ? (
        <GenerationFilteredArticles articles={content.articles} />
      ) : null}

      {content.faq.length ? (
        <section className="space-y-3" aria-label="Вопросы">
          <h2 className="font-heading text-xl font-bold">Вопросы</h2>
          {content.faq.map((item) => (
            <article key={item.id} className="voltflow-card p-4">
              <h3 className="font-heading text-base font-bold">{item.question}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.answer}</p>
            </article>
          ))}
        </section>
      ) : null}

      {accessories.length ? (
        <section className="space-y-3" aria-label="Аксессуары">
          <h2 className="font-heading text-xl font-bold">Аксессуары</h2>
          {accessories.map((item, index) => (
            <AccessoryCard key={item.id} item={item} priorityImage={index === 0} />
          ))}
        </section>
      ) : null}

      {spareParts.length ? (
        <SparePartsCatalog generation={generation} items={spareParts} />
      ) : null}

      {!content.articles.length &&
      !content.faq.length &&
      !content.accessories.length &&
      !content.spareParts.length ? (
        <div className="voltflow-card p-4 text-sm leading-6 text-muted-foreground">
          Раздел подготовлен, но материалы в него еще не добавлены.
        </div>
      ) : null}
    </>
  );
}
