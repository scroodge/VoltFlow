"use client";

import { BookOpen, HelpCircle, Home, Menu, ShoppingBag } from "lucide-react";

import { cn } from "@/lib/utils";

export type TelegramTab = "home" | "guides" | "faq" | "buy" | "more";

type BottomTabsProps = {
  activeTab: TelegramTab;
  onTabChange: (tab: TelegramTab) => void;
};

const tabs = [
  { id: "home", label: "Главная", icon: Home },
  { id: "guides", label: "Гайды", icon: BookOpen },
  { id: "faq", label: "Вопросы", icon: HelpCircle },
  { id: "buy", label: "Купить", icon: ShoppingBag },
  { id: "more", label: "Еще", icon: Menu },
] satisfies Array<{
  id: TelegramTab;
  label: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}>;

export function BottomTabs({ activeTab, onTabChange }: BottomTabsProps) {
  return (
    <nav className="bottom-nav" aria-label="Telegram mini app sections">
      <div className="mx-auto grid max-w-[430px] grid-cols-5 gap-1.5">
        {tabs.map(({ id, label, icon: Icon }) => {
          const isActive = activeTab === id;

          return (
            <button
              key={id}
              type="button"
              onClick={() => onTabChange(id)}
              className={cn(
                "flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-lg border px-1 text-[10px] font-semibold transition",
                isActive
                  ? "border-[var(--voltflow-green)]/60 bg-[var(--voltflow-green)]/14 text-[var(--voltflow-green)] shadow-[0_0_20px_rgba(0,230,118,0.18)]"
                  : "border-transparent bg-white/[0.03] text-muted-foreground hover:border-border hover:text-foreground",
              )}
              aria-current={isActive ? "page" : undefined}
              aria-label={`Открыть ${label}`}
            >
              <Icon className="size-4" aria-hidden />
              <span className="leading-none">{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
