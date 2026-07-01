"use client";

import { BookOpen, HelpCircle, Home, Menu, Search, ShoppingBag } from "lucide-react";
import { useState } from "react";

import { KnowledgeView, type TelegramTab } from "@/components/knowledge/knowledge-view";
import { GenerationFilter } from "@/components/telegram/GenerationFilter";
import { useTelegramGeneration } from "@/hooks/use-telegram-generation";
import type { TelegramKnowledgeData } from "@/types/knowledge";
import { cn } from "@/lib/utils";

const tabs = [
  { id: "home" as TelegramTab, label: "Главная", icon: Home },
  { id: "guides" as TelegramTab, label: "Гайды", icon: BookOpen },
  { id: "faq" as TelegramTab, label: "Вопросы", icon: HelpCircle },
  { id: "buy" as TelegramTab, label: "Купить", icon: ShoppingBag },
  { id: "more" as TelegramTab, label: "Еще", icon: Menu },
];

export function KnowledgeHub({ data }: { data?: TelegramKnowledgeData }) {
  const [generation, setGeneration] = useTelegramGeneration();
  const [activeTab, setActiveTab] = useState<TelegramTab>("home");

  return (
    <div className="px-3 py-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-xl font-bold">База знаний</h1>
          <p className="text-sm text-muted-foreground">База знаний BYD YUAN UP</p>
        </div>
        <Search className="size-5 text-muted-foreground" aria-hidden />
      </div>

      <section
        className="mb-4 rounded-lg border border-border bg-white/[0.03] p-1.5"
        aria-label="Поколение автомобиля"
      >
        <GenerationFilter value={generation} onChange={setGeneration} />
      </section>

      <nav
        className="-mx-3 mb-4 flex gap-1 overflow-x-auto px-3"
        aria-label="Knowledge sections"
      >
        {tabs.map(({ id, label, icon: Icon }) => {
          const isActive = activeTab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition",
                isActive
                  ? "bg-[var(--voltflow-green)]/14 text-[var(--voltflow-green)]"
                  : "text-muted-foreground hover:text-foreground",
              )}
              aria-current={isActive ? "page" : undefined}
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </button>
          );
        })}
      </nav>

      <KnowledgeView
        data={data}
        generation={generation}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />
    </div>
  );
}
