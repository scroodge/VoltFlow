"use client";

import {
  BatteryCharging,
  Calculator,
  CarFront,
  HelpCircle,
  Loader2,
  Settings,
  ShoppingBag,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";

import { chargingGuides } from "@/data/telegram/charging-guides";
import type { CarGeneration } from "@/lib/car-generations";
import type { TelegramTab } from "@/components/telegram/BottomTabs";
import { ArticleCard } from "@/components/telegram/ArticleCard";
import { SearchBox } from "@/components/telegram/SearchBox";
import type { TelegramKnowledgeData } from "@/types/knowledge";

type KnowledgeHomeProps = {
  isTelegram: boolean;
  onNavigate: (tab: TelegramTab) => void;
  generation: CarGeneration;
  data?: Pick<TelegramKnowledgeData, "articles" | "faq" | "accessories">;
};

type SemanticSearchResult = {
  id: string;
  title: string;
  content: string;
  category: string;
  source_type: string;
  source_url: string | null;
  telegram_message_id: string | null;
  tags: string[];
  similarity: number;
};

const quickCards = [
  { label: "Зарядка", tab: "guides", icon: BatteryCharging },
  { label: "Эксплуатация", tab: "guides", icon: CarFront },
  { label: "Обслуживание", tab: "guides", icon: Wrench },
  { label: "Купить", tab: "buy", icon: ShoppingBag },
  { label: "Еще", tab: "more", icon: Calculator },
  { label: "Вопросы", tab: "faq", icon: HelpCircle },
] satisfies Array<{
  label: string;
  tab: TelegramTab;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}>;

export function KnowledgeHome({
  onNavigate,
  generation,
  data,
}: KnowledgeHomeProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SemanticSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const popularArticles = (
    data?.articles.filter((article) => article.categorySlug === "charging") ?? chargingGuides
  ).slice(0, 4);
  const trimmedQuery = query.trim();

  async function handleSearch(nextQuery: string) {
    setQuery(nextQuery);
    const nextTrimmedQuery = nextQuery.trim();
    searchAbortRef.current?.abort();

    if (nextTrimmedQuery.length < 2) {
      setResults([]);
      setIsSearching(false);
      setSearchError(null);
      return;
    }

    const controller = new AbortController();
    searchAbortRef.current = controller;
    setIsSearching(true);
    setSearchError(null);

    try {
      const response = await fetch("/api/knowledge/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: nextTrimmedQuery, generation, limit: 6 }),
        signal: controller.signal,
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error ?? "Search failed.");
      }

      setResults(Array.isArray(payload.results) ? payload.results : []);
    } catch (error) {
      if (controller.signal.aborted) return;
      console.error("Telegram semantic search error:", error);
      setResults([]);
      setSearchError("Не удалось выполнить умный поиск. Попробуйте позже.");
    } finally {
      if (!controller.signal.aborted) {
        setIsSearching(false);
      }
    }
  }

  return (
    <section className="space-y-3" aria-labelledby="knowledge-home-title">
      <div className="space-y-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--voltflow-cyan)]">
          VoltFlow
        </p>
        <h1 id="knowledge-home-title" className="font-heading text-2xl font-bold leading-tight">
          Умный поиск
        </h1>
        <p className="text-sm leading-5 text-muted-foreground">
          Введите любой запрос и умный поиск найдет информацию
        </p>
      </div>

      <SearchBox
        value={query}
        onChange={handleSearch}
        placeholder="Например: как заряжать зимой, коврики, медленно заряжается"
        debounceMs={350}
      />

      {trimmedQuery ? (
        <SemanticSearchResults
          error={searchError}
          isLoading={isSearching}
          query={trimmedQuery}
          results={results}
        />
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        {quickCards.map(({ label, tab, icon: Icon }) => (
          <button
            key={label}
            type="button"
            onClick={() => onNavigate(tab)}
            className="voltflow-card flex min-h-14 items-center gap-3 p-3 text-left transition hover:border-[var(--voltflow-cyan)]/60"
          >
            <Icon className="size-5 shrink-0 text-[var(--voltflow-green)]" aria-hidden />
            <span className="font-heading text-sm font-bold leading-none">{label}</span>
          </button>
        ))}
      </div>

      <section className="space-y-2.5" aria-labelledby="popular-title">
        <div className="flex items-center gap-2">
          <Settings className="size-4 text-[var(--voltflow-cyan)]" aria-hidden />
          <h2 id="popular-title" className="font-heading text-base font-bold">
            Популярные статьи
          </h2>
        </div>
        {popularArticles.map((article, index) => (
          <ArticleCard key={article.id} article={article} priorityImage={index === 0} />
        ))}
        <Link
          href={`/telegram/category/charging?gen=${generation}`}
          className="inline-flex min-h-9 items-center rounded-lg border border-border bg-white/[0.04] px-3 text-sm font-semibold text-[var(--voltflow-cyan)]"
        >
          Открыть раздел зарядки
        </Link>
      </section>

      <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-xs leading-5 text-amber-100">
        База знаний сейчас ведется вручную. Импорт из сообщества и AI-помощник
        будут добавлены позже.
      </div>
    </section>
  );
}

function SemanticSearchResults({
  error,
  isLoading,
  query,
  results,
}: {
  error: string | null;
  isLoading: boolean;
  query: string;
  results: SemanticSearchResult[];
}) {
  if (isLoading) {
    return (
      <div className="voltflow-card flex items-center gap-2.5 p-3 text-sm font-semibold text-muted-foreground">
        <Loader2 className="size-4 animate-spin text-[var(--voltflow-cyan)]" aria-hidden />
        Ищем по смыслу...
      </div>
    );
  }

  if (error) {
    return <div className="voltflow-card p-3 text-sm leading-5 text-muted-foreground">{error}</div>;
  }

  if (!results.length) {
    return (
      <div className="voltflow-card p-3 text-sm leading-5 text-muted-foreground">
        Ничего не найдено для «{query}». Попробуйте переформулировать вопрос.
      </div>
    );
  }

  return (
    <section className="space-y-2" aria-label="Результаты умного поиска">
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--voltflow-cyan)]">
        Умный поиск
      </p>
      {results.map((result) => {
        const card = (
          <>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--voltflow-green)]">
                  {categoryLabel(result.category)}
                </p>
                <h3 className="mt-0.5 font-heading text-sm font-bold">{result.title}</h3>
              </div>
              <span className="shrink-0 rounded-full border border-[var(--voltflow-green)]/40 bg-[var(--voltflow-green)]/10 px-2 py-0.5 text-[11px] font-bold text-[var(--voltflow-green)]">
                {Math.round(result.similarity * 100)}%
              </span>
            </div>
            <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-muted-foreground">
              {result.content}
            </p>
            {result.tags.length ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {result.tags.slice(0, 4).map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-border bg-white/[0.04] px-2 py-0.5 text-[11px] font-semibold text-muted-foreground"
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
            className="voltflow-card block p-3 transition hover:border-[var(--voltflow-cyan)]/60 focus-visible:ring-3 focus-visible:ring-[var(--voltflow-cyan)]/30"
          >
            {card}
          </Link>
        ) : (
          <article key={result.id} className="voltflow-card p-3">
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
    winter: "Зима",
  };

  return labels[category] ?? category;
}
