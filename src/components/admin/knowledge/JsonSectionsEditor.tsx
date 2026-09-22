"use client";

import { Plus, X } from "lucide-react";
import Image from "next/image";
import { useState } from "react";

import type { KnowledgeArticleSection } from "@/types/knowledge";

export function JsonSectionsEditor({
  defaultValue = [{ heading: "", body: "" }],
  error,
}: {
  defaultValue?: KnowledgeArticleSection[];
  error?: string;
}) {
  const [sections, setSections] = useState(
    defaultValue.length ? defaultValue : [{ heading: "", body: "" }],
  );

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold">Блоки контента</p>
        {error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
      </div>
      {sections.map((section, index) => (
        <div key={index} className="rounded-lg border border-border bg-white/[0.03] p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
              Блок {index + 1}
            </p>
            <button
              type="button"
              onClick={() =>
                setSections((items) => items.filter((_, itemIndex) => itemIndex !== index))
              }
              className="grid size-8 place-items-center rounded-lg border border-border text-muted-foreground hover:text-foreground"
              aria-label="Remove section"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
          <input
            name="content_heading"
            defaultValue={section.heading}
            className="mt-3 min-h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
            placeholder="Заголовок"
          />
          <textarea
            name="content_body"
            defaultValue={section.body}
            className="mt-3 min-h-28 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
            placeholder="Текст"
          />
          <div className="mt-3 space-y-2">
            <label className="block space-y-1.5 text-sm font-semibold">
              <span>Картинки внутри блока</span>
              <input
                name={`content_image_files_${index}`}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-bold file:text-primary-foreground"
              />
              <span className="text-xs font-normal text-muted-foreground">
                Можно добавить одну или несколько картинок для этого блока.
              </span>
            </label>
            {section.images?.length ? (
              <div className="grid gap-3 md:grid-cols-3">
                {section.images.map((image, imageIndex) => (
                  <div key={`${image.url}-${imageIndex}`} className="rounded-lg border border-border bg-white/[0.03] p-2">
                    <Image
                      src={image.url}
                      alt={image.alt || section.heading || `Картинка блока ${index + 1}`}
                      width={320}
                      height={180}
                      unoptimized
                      className="aspect-[16/9] w-full rounded-lg object-cover"
                    />
                    <input type="hidden" name="content_image_section_index" value={index} />
                    <input type="hidden" name="content_image_url" value={image.url} />
                    <input
                      name="content_image_alt"
                      defaultValue={image.alt}
                      className="mt-2 min-h-9 w-full rounded-lg border border-input bg-background px-2 text-xs outline-none"
                      placeholder="Описание картинки"
                    />
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={() => setSections((items) => [...items, { heading: "", body: "" }])}
        className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm font-semibold text-[var(--voltflow-cyan)]"
      >
        <Plus className="size-4" aria-hidden />
        Добавить блок
      </button>
    </div>
  );
}
