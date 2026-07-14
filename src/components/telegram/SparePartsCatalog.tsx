"use client";

import Image from "next/image";
import Link from "next/link";

import { SearchBox } from "@/components/telegram/SearchBox";
import { SemanticSearchResults } from "@/components/telegram/SemanticSearchResults";
import { useSemanticKnowledgeSearch } from "@/hooks/use-semantic-knowledge-search";
import type { CarGeneration } from "@/lib/car-generations";
import type { SparePartItem } from "@/types/knowledge";

export function SparePartsCatalog({
  generation,
  items = [],
  compactHeader = false,
}: {
  generation: CarGeneration;
  items?: SparePartItem[];
  compactHeader?: boolean;
}) {
  const search = useSemanticKnowledgeSearch({
    generation,
    limit: 8,
    sourceTypes: ["spare_part"],
  });

  if (!items.length) return null;

  return (
    <section className="space-y-4" aria-labelledby="spare-parts-title">
      {compactHeader ? null : (
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--voltflow-cyan)]">
            Запчасти
          </p>
          <h2 id="spare-parts-title" className="mt-1 font-heading text-2xl font-bold">
            Запчасти и расходники
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Описание, совместимость, фото ракурсов и ссылки на варианты покупки.
          </p>
        </div>
      )}
      <SearchBox
        value={search.query}
        onChange={search.search}
        placeholder="Искать запчасти"
        debounceMs={350}
      />
      {search.trimmedQuery ? (
        <SemanticSearchResults
          error={search.error}
          isLoading={search.isSearching}
          query={search.trimmedQuery}
          results={search.results}
          title="Найденные запчасти"
        />
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <SparePartCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}

function SparePartCard({ item }: { item: SparePartItem }) {
  const cover = item.images[0];

  return (
    <Link href={`/telegram/spare-part/${item.id}`} className="voltflow-card block p-4 transition hover:border-[var(--voltflow-cyan)]/60 focus-visible:ring-3 focus-visible:ring-[var(--voltflow-cyan)]/30">
      {cover ? (
        <div className="mb-4 block w-full overflow-hidden rounded-lg border border-border">
          <Image
            src={cover.url}
            alt={cover.alt || item.title}
            width={640}
            height={360}
            unoptimized
            className="aspect-[16/9] w-full object-cover"
          />
        </div>
      ) : null}

      <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--voltflow-green)]">
        Запчасти
      </p>
      <h3 className="mt-1 font-heading text-lg font-bold">{item.title}</h3>
      {item.description ? (
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{item.description}</p>
      ) : null}
      {item.part_number || item.compatibility ? (
        <div className="mt-3 rounded-lg border border-border bg-white/[0.03] p-3 text-sm leading-6 text-muted-foreground">
          {item.part_number ? <p><span className="font-semibold text-foreground">Номер:</span> {item.part_number}</p> : null}
          {item.compatibility ? <p><span className="font-semibold text-foreground">Совместимость:</span> {item.compatibility}</p> : null}
        </div>
      ) : null}
    </Link>
  );
}
