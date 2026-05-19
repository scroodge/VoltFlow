"use client";

import { ChevronLeft, ChevronRight, ExternalLink, X } from "lucide-react";
import Image from "next/image";
import { useState } from "react";

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
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [activeImage, setActiveImage] = useState(0);
  const cover = item.images[0];

  function move(delta: number) {
    setActiveImage((current) => (current + delta + item.images.length) % item.images.length);
  }

  return (
    <article className="voltflow-card p-4">
      {cover ? (
        <button
          type="button"
          onClick={() => {
            setActiveImage(0);
            setGalleryOpen(true);
          }}
          className="mb-4 block w-full overflow-hidden rounded-lg border border-border text-left"
        >
          <Image
            src={cover.url}
            alt={cover.alt || item.title}
            width={640}
            height={360}
            unoptimized
            className="aspect-[16/9] w-full object-cover"
          />
        </button>
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
      {item.external_links.length ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {item.external_links.map((link) => (
            <a
              key={`${link.label}-${link.url}`}
              href={link.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border bg-white/[0.04] px-4 text-sm font-semibold text-[var(--voltflow-cyan)] transition hover:bg-white/[0.07]"
            >
              {link.label}
              <ExternalLink className="size-4" aria-hidden />
            </a>
          ))}
        </div>
      ) : null}

      {galleryOpen && item.images.length ? (
        <div className="fixed inset-0 z-[80] bg-black/80 p-4 backdrop-blur-sm">
          <div className="mx-auto flex h-full max-w-[430px] flex-col justify-center">
            <div className="rounded-lg border border-border bg-card p-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="min-w-0 truncate text-sm font-bold">{item.title}</p>
                <button
                  type="button"
                  onClick={() => setGalleryOpen(false)}
                  className="grid size-9 place-items-center rounded-lg border border-border"
                  aria-label="Закрыть галерею"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>
              <Image
                src={item.images[activeImage].url}
                alt={item.images[activeImage].alt || item.title}
                width={800}
                height={600}
                unoptimized
                className="max-h-[70dvh] w-full rounded-lg object-contain"
              />
              {item.images.length > 1 ? (
                <div className="mt-3 flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => move(-1)}
                    className="grid size-10 place-items-center rounded-lg border border-border"
                    aria-label="Предыдущее фото"
                  >
                    <ChevronLeft className="size-5" aria-hidden />
                  </button>
                  <span className="text-sm font-semibold text-muted-foreground">
                    {activeImage + 1} / {item.images.length}
                  </span>
                  <button
                    type="button"
                    onClick={() => move(1)}
                    className="grid size-10 place-items-center rounded-lg border border-border"
                    aria-label="Следующее фото"
                  >
                    <ChevronRight className="size-5" aria-hidden />
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </article>
  );
}
