"use client";

import { useState } from "react";

import { AccessoriesCatalog } from "@/components/telegram/AccessoriesCatalog";
import { SparePartsCatalog } from "@/components/telegram/SparePartsCatalog";
import type { CarGeneration } from "@/lib/car-generations";
import { cn } from "@/lib/utils";
import type { TelegramKnowledgeData } from "@/types/knowledge";

type BuyTab = "accessories" | "spare-parts";

const tabs = [
  { id: "accessories", label: "Аксессуары" },
  { id: "spare-parts", label: "Запчасти" },
] satisfies Array<{ id: BuyTab; label: string }>;

export function BuyCatalog({
  accessories,
  generation,
  spareParts,
}: {
  accessories?: TelegramKnowledgeData["accessories"];
  generation: CarGeneration;
  spareParts?: TelegramKnowledgeData["spareParts"];
}) {
  const [activeTab, setActiveTab] = useState<BuyTab>("accessories");

  return (
    <section className="space-y-4" aria-labelledby="buy-title">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--voltflow-cyan)]">
          Купить
        </p>
        <h2 id="buy-title" className="mt-1 font-heading text-2xl font-bold">
          Аксессуары и запчасти
        </h2>
      </div>

      <div className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-white/[0.03] p-1">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "min-h-10 rounded-lg px-3 text-sm font-bold transition",
                isActive
                  ? "bg-[var(--voltflow-green)] text-[#06110B]"
                  : "text-muted-foreground hover:bg-white/[0.05] hover:text-foreground",
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === "accessories" ? (
        <AccessoriesCatalog generation={generation} items={accessories} compactHeader />
      ) : (
        <SparePartsCatalog generation={generation} items={spareParts} compactHeader />
      )}
    </section>
  );
}
