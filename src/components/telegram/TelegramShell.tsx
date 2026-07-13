"use client";

import { ArrowRight, Zap } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  BottomTabs,
  type TelegramTab,
} from "@/components/telegram/BottomTabs";
import { GenerationFilter } from "@/components/telegram/GenerationFilter";
import { KnowledgeView } from "@/components/knowledge/knowledge-view";
import { useAutoDetectCarGeneration } from "@/hooks/use-auto-detect-car-generation";
import { useTelegramGeneration } from "@/hooks/use-telegram-generation";
import { useTranslation } from "@/hooks/use-translation";
import { getTelegramThemeStyle } from "@/lib/telegram/theme";
import { loginWithTelegram } from "@/lib/telegram/login";
import { useTelegramWebApp } from "@/lib/telegram/useTelegramWebApp";
import type { TelegramKnowledgeData } from "@/types/knowledge";
import { cn } from "@/lib/utils";

export function TelegramShell({ data }: { data?: TelegramKnowledgeData }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { t } = useTranslation();
  const [generation, setGeneration] = useTelegramGeneration();
  const [activeTab, setActiveTab] = useState<TelegramTab>("home");
  const [openAppBusy, setOpenAppBusy] = useState(false);
  const telegram = useTelegramWebApp();
  const themeStyle = useMemo(
    () => getTelegramThemeStyle(telegram.themeParams),
    [telegram.themeParams],
  );

  useEffect(() => {
    const tab = searchParams.get("tab") as TelegramTab | null;
    window.setTimeout(() => {
      if (tab && ["home", "guides", "faq", "buy", "more"].includes(tab)) {
        setActiveTab(tab);
      } else {
        setActiveTab("home");
      }
    }, 0);
  }, [searchParams]);

  const changeTab = useCallback(
    (tab: TelegramTab) => {
      setActiveTab(tab);
      const params = new URLSearchParams(searchParams);
      if (tab === "home") {
        params.delete("tab");
      } else {
        params.set("tab", tab);
      }
      const query = params.toString();
      router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [searchParams, pathname, router],
  );

  const urlGeneration = searchParams.get("gen");

  useAutoDetectCarGeneration(setGeneration, urlGeneration);

  async function openAppFromKnowledge() {
    if (!telegram.isTelegram) {
      router.push("/login?next=/dashboard");
      return;
    }

    setOpenAppBusy(true);
    const result = await loginWithTelegram();
    if (result.ok) {
      router.push("/dashboard");
      return;
    }

    toast.error(`${t("telegram.loginError") as string} (${result.error})`, {
      description: t("telegram.loginExistingHint") as string,
      action: {
        label: t("telegram.loginExistingAction") as string,
        onClick: () => router.push("/login?next=/telegram"),
      },
    });
    setOpenAppBusy(false);
  }

  return (
    <main
      className={cn(
        "relative isolate min-h-dvh overflow-x-hidden scroll-smooth bg-background text-foreground",
        telegram.isTelegram && "telegram-webview",
      )}
      style={themeStyle}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_-8%,rgba(0,209,255,0.16),transparent_22rem),linear-gradient(180deg,rgba(18,21,28,0)_0%,#12151C_72%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px voltflow-gradient" />

      <div className="mobile-page relative min-h-dvh px-3 pb-[calc(env(safe-area-inset-bottom)+5.75rem)] pt-[calc(env(safe-area-inset-top)+0.5rem)]">
        <header className="sticky top-0 z-30 -mx-3 space-y-2 border-b border-border/60 bg-background/88 px-3 pb-2.5 pt-[calc(env(safe-area-inset-top)+0.5rem)] backdrop-blur-xl">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="grid size-8 shrink-0 place-items-center rounded-lg border border-[var(--voltflow-green)]/30 bg-[var(--voltflow-green)]/10 text-[var(--voltflow-green)]">
                <Zap className="size-4" aria-hidden />
              </div>
              <div>
                <h1 className="font-heading text-lg font-bold leading-none">
                  VoltFlow
                </h1>
                <p className="mt-0.5 text-xs font-semibold text-muted-foreground">
                  База знаний BYD YUAN UP
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <span className="rounded-full border border-border bg-white/[0.04] px-2.5 py-1 text-[11px] font-bold text-[var(--voltflow-cyan)]">
                {telegram.isTelegram ? "Telegram" : "Веб"}
              </span>
              <button
                type="button"
                onClick={() => void openAppFromKnowledge()}
                disabled={openAppBusy}
                className="flex min-h-9 max-w-[8.75rem] items-center gap-1.5 rounded-full border border-[var(--voltflow-green)]/35 bg-[var(--voltflow-green)] px-3 text-xs font-bold text-[#08130C] transition-opacity disabled:opacity-60"
              >
                <span className="truncate">
                  {openAppBusy
                    ? t("telegram.openingApp")
                    : telegram.isTelegram
                      ? t("telegram.openApp")
                      : t("telegram.openFullApp")}
                </span>
                {!openAppBusy ? <ArrowRight className="size-3.5" aria-hidden /> : null}
              </button>
            </div>
          </div>

        </header>

        {/* Scrolls away with the content rather than pinning: this is a set-once choice
            (already guessed by useAutoDetectCarGeneration), and inside the sticky header
            it cost ~60px of a ~700px viewport on every screen, forever. */}
        <section
          className="mt-2 rounded-lg border border-border bg-white/[0.03] p-1.5"
          aria-label="Поколение автомобиля"
        >
          <GenerationFilter value={generation} onChange={setGeneration} />
        </section>

        <KnowledgeView
          data={data}
          generation={generation}
          activeTab={activeTab}
          onTabChange={changeTab}
        />
      </div>

      <BottomTabs activeTab={activeTab} onTabChange={changeTab} />
    </main>
  );
}
