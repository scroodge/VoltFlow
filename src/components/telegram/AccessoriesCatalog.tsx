"use client";

import { useMemo, useState } from "react";

import { AccessoryCard } from "@/components/telegram/ArticleCard";
import { CategoryFilter } from "@/components/telegram/CategoryFilter";
import { SearchBox } from "@/components/telegram/SearchBox";
import { SectionHeader } from "@/components/telegram/ChargingGuides";
import { accessories } from "@/data/telegram/accessories";
import { accessoryCategories } from "@/data/telegram/categories";
import type { AccessoryItem } from "@/types/telegram";

type AccessoryCategory = (typeof accessoryCategories)[number];

export function AccessoriesCatalog({ items: providedItems }: { items?: AccessoryItem[] }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<AccessoryCategory | "All">("All");
  const sourceItems = providedItems ?? accessories;

  const items = useMemo(() => {
    const value = query.trim().toLowerCase();

    return sourceItems.filter((item) => {
      const matchesCategory = category === "All" || item.category === category;
      const matchesQuery =
        !value ||
        [
          item.title,
          item.category,
          item.useCase,
          item.whyUseful,
          item.searchKeywords.join(" "),
          item.whatToCheckBeforeBuying.join(" "),
        ]
          .join(" ")
          .toLowerCase()
          .includes(value);

      return matchesCategory && matchesQuery;
    });
  }, [category, query, sourceItems]);

  return (
    <section className="space-y-4" aria-labelledby="accessories-title">
      <SectionHeader
        eyebrow="Accessories"
        title="Useful items without fake links"
        description="Static recommendations with checks, risks, priorities, and search keywords for Phase 1."
        id="accessories-title"
      />
      <SearchBox value={query} onChange={setQuery} placeholder="Search accessories" />
      <CategoryFilter
        categories={accessoryCategories}
        activeCategory={category}
        onChange={setCategory}
      />
      <div className="space-y-3">
        {items.map((item) => (
          <AccessoryCard key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
}
