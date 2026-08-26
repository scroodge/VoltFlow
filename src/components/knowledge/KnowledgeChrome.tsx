"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { BottomTabs, type TelegramTab } from "@/components/telegram/BottomTabs";
import { GenerationFilter } from "@/components/telegram/GenerationFilter";
import { KnowledgeView } from "@/components/knowledge/knowledge-view";
import { useAutoDetectCarGeneration } from "@/hooks/use-auto-detect-car-generation";
import { useTelegramGeneration } from "@/hooks/use-telegram-generation";
import type { TelegramKnowledgeData } from "@/types/knowledge";

/**
 * Interactive body of the public knowledge base at `/knowledge`.
 *
 * Replaces the former TelegramShell + KnowledgeHub pair, which were two wrappers
 * around this same KnowledgeView. `/telegram` is now the Mini App entry gate
 * only and renders no KB markup at all.
 *
 * This calls useSearchParams(), so under static rendering Next prerenders its
 * `<Suspense fallback={null}>` and defers the whole subtree to the client. That
 * is why the page frame, the <h1> (KnowledgeHeader) and the crawlable link tree
 * (KnowledgeIndex) all live OUTSIDE the boundary in `page.tsx` — without that,
 * /knowledge prerenders as an empty shell.
 */
export function KnowledgeChrome({ data }: { data?: TelegramKnowledgeData }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [generation, setGeneration] = useTelegramGeneration();
  const [activeTab, setActiveTab] = useState<TelegramTab>("home");

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

  return (
    <>
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

      <BottomTabs activeTab={activeTab} onTabChange={changeTab} />
    </>
  );
}
