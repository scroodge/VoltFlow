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
import { useMemo, useState } from "react";

import { chargingGuides } from "@/data/telegram/charging-guides";
import { searchTelegramKnowledge } from "@/lib/telegram/search";
import type { TelegramTab } from "@/components/telegram/BottomTabs";
import { ArticleCard } from "@/components/telegram/ArticleCard";
import { SearchBox } from "@/components/telegram/SearchBox";
import { SearchResults } from "@/components/telegram/SearchResults";
import type { TelegramKnowledgeData } from "@/types/knowledge";

type KnowledgeHomeProps = {
  isTelegram: boolean;
  onNavigate: (tab: TelegramTab) => void;
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

export function KnowledgeHome({ isTelegram, onNavigate, data }: KnowledgeHomeProps) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => searchTelegramKnowledge(query, 6, data), [data, query]);
  const popularArticles = (data?.articles.filter((article) => article.categorySlug === "charging") ?? chargingGuides).slice(0, 4);

  return (
    <section className="space-y-5" aria-labelledby="knowledge-home-title">
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--voltflow-cyan)]">
              VoltFlow
            </p>
            <h1 id="knowledge-home-title" className="mt-1 font-heading text-3xl font-bold leading-tight">
              База знаний BYD YUAN UP
            </h1>
          </div>
          <span className="shrink-0 rounded-full border border-border bg-white/[0.04] px-3 py-1.5 text-xs font-bold text-[var(--voltflow-cyan)]">
            {isTelegram ? "Мини-приложение Telegram" : "Веб-режим"}
          </span>
        </div>
        <p className="text-base leading-7 text-muted-foreground">
          Зарядка, обслуживание, аксессуары и практический опыт владельца
        </p>
      </div>

      <SearchBox value={query} onChange={setQuery} />

      {query.trim() ? <SearchResults query={query} results={results} /> : null}

      <div className="grid grid-cols-2 gap-3">
        {quickCards.map(({ label, tab, icon: Icon }) => (
          <button
            key={label}
            type="button"
            onClick={() => onNavigate(tab)}
            className="voltflow-card flex min-h-24 flex-col items-start justify-between p-4 text-left transition hover:border-[var(--voltflow-cyan)]/60"
          >
            <Icon className="size-6 text-[var(--voltflow-green)]" aria-hidden />
            <span className="font-heading text-base font-bold">{label}</span>
          </button>
        ))}
      </div>

      <section className="space-y-3" aria-labelledby="popular-title">
        <div className="flex items-center gap-2">
          <Settings className="size-4 text-[var(--voltflow-cyan)]" aria-hidden />
          <h2 id="popular-title" className="font-heading text-xl font-bold">
            Популярные статьи
          </h2>
        </div>
        {popularArticles.map((article, index) => (
          <ArticleCard key={article.id} article={article} priorityImage={index === 0} />
        ))}
        <Link
          href="/telegram/category/charging"
          className="inline-flex min-h-11 items-center rounded-lg border border-border bg-white/[0.04] px-4 text-sm font-semibold text-[var(--voltflow-cyan)]"
        >
          Открыть раздел зарядки
        </Link>
      </section>

      <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-4 text-sm leading-6 text-amber-100">
        База знаний сейчас ведется вручную. Импорт из сообщества и AI-поиск
        будут добавлены позже.
      </div>
    </section>
  );
}
