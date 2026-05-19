"use client";

import { useMemo, useState } from "react";

import { AccessoryCard } from "@/components/telegram/ArticleCard";
import { CategoryFilter } from "@/components/telegram/CategoryFilter";
import { SearchBox } from "@/components/telegram/SearchBox";
import { SemanticSearchResults } from "@/components/telegram/SemanticSearchResults";
import { SectionHeader } from "@/components/telegram/ChargingGuides";
import { accessories } from "@/data/telegram/accessories";
import { accessoryCategories } from "@/data/telegram/categories";
import { useSemanticKnowledgeSearch } from "@/hooks/use-semantic-knowledge-search";
import type { CarGeneration } from "@/lib/car-generations";
import type { AccessoryItem } from "@/types/telegram";

type AccessoryCategory = (typeof accessoryCategories)[number];

const accessoryCategorySlugs: Partial<Record<AccessoryCategory, string>> = {
  "Аксессуары": "accessories",
  "Безопасность": "safety",
  "Зима": "winter",
};

export function AccessoriesCatalog({
  generation,
  items: providedItems,
  compactHeader = false,
}: {
  generation: CarGeneration;
  items?: AccessoryItem[];
  compactHeader?: boolean;
}) {
  const [category, setCategory] = useState<AccessoryCategory | "All">("All");
  const sourceItems = providedItems ?? accessories;
  const search = useSemanticKnowledgeSearch({
    category: category === "All" ? null : accessoryCategorySlugs[category],
    generation,
    limit: 8,
    sourceTypes: ["accessory"],
  });

  const items = useMemo(() => {
    return sourceItems.filter((item) => {
      const matchesCategory = category === "All" || item.category === category;
      return matchesCategory;
    });
  }, [category, sourceItems]);

  return (
    <section className="space-y-4" aria-labelledby="accessories-title">
      {compactHeader ? null : (
        <SectionHeader
          eyebrow="Аксессуары"
          title="Полезные вещи без фейковых ссылок"
          description="Рекомендации с проверками, рисками, приоритетом и поисковыми подсказками."
          id="accessories-title"
        />
      )}
      <SearchBox
        value={search.query}
        onChange={search.search}
        placeholder="Искать аксессуары"
        debounceMs={350}
      />
      <CategoryFilter
        categories={accessoryCategories}
        activeCategory={category}
        onChange={setCategory}
      />
      {search.trimmedQuery ? (
        <SemanticSearchResults
          error={search.error}
          isLoading={search.isSearching}
          query={search.trimmedQuery}
          results={search.results}
          title="Найденные аксессуары"
        />
      ) : (
        <div className="space-y-3">
          {items.map((item, index) => (
            <AccessoryCard key={item.id} item={item} priorityImage={index === 0} />
          ))}
        </div>
      )}
    </section>
  );
}
