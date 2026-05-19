"use client";

import {
  BatteryCharging,
  Calculator,
  CarFront,
  HelpCircle,
  Settings,
  ShoppingBag,
  Wrench,
} from "lucide-react";
import Link from "next/link";

import { chargingGuides } from "@/data/telegram/charging-guides";
import { useSemanticKnowledgeSearch } from "@/hooks/use-semantic-knowledge-search";
import type { CarGeneration } from "@/lib/car-generations";
import type { TelegramTab } from "@/components/telegram/BottomTabs";
import { ArticleCard } from "@/components/telegram/ArticleCard";
import { SearchBox } from "@/components/telegram/SearchBox";
import { SemanticSearchResults } from "@/components/telegram/SemanticSearchResults";
import type { TelegramKnowledgeData } from "@/types/knowledge";

type KnowledgeHomeProps = {
  isTelegram: boolean;
  onNavigate: (tab: TelegramTab) => void;
  generation: CarGeneration;
  data?: Pick<TelegramKnowledgeData, "articles" | "faq" | "accessories">;
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
  const search = useSemanticKnowledgeSearch({
    generation,
    limit: 6,
    sourceTypes: ["article", "faq", "accessory", "spare_part"],
  });
  const popularArticles = (
    data?.articles.filter((article) => article.categorySlug === "charging") ?? chargingGuides
  ).slice(0, 4);

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
