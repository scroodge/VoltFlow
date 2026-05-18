"use client";

import { AlertTriangle, ArrowLeft, ChevronLeft, ChevronRight, Clipboard, Lightbulb, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { KnowledgeArticle } from "@/types/telegram";

type ArticleRendererProps = {
  article: KnowledgeArticle;
  relatedArticles?: KnowledgeArticle[];
};

export function ArticleRenderer({
  article,
  relatedArticles = [],
}: ArticleRendererProps) {
  const router = useRouter();
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "unavailable">(
    "idle",
  );
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [activeImage, setActiveImage] = useState(0);
  const images = article.images ?? [];

  function moveImage(delta: number) {
    setActiveImage((current) => (current + delta + images.length) % images.length);
  }

  async function copyLink() {
    if (typeof window === "undefined" || !navigator.clipboard) {
      setCopyStatus("unavailable");
      return;
    }

    try {
      const articleUrl = `${window.location.origin}/telegram/article/${article.slug}`;
      await navigator.clipboard.writeText(articleUrl);
      setCopyStatus("copied");
      window.setTimeout(() => setCopyStatus("idle"), 1800);
    } catch {
      setCopyStatus("unavailable");
      window.setTimeout(() => setCopyStatus("idle"), 1800);
    }
  }

  return (
    <article className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => router.back()}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-white/[0.04] px-4 text-sm font-semibold text-muted-foreground transition hover:text-foreground focus-visible:ring-3 focus-visible:ring-[var(--voltflow-cyan)]/30"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Назад
        </button>
        <Link
          href="/telegram"
          className="inline-flex min-h-11 items-center rounded-lg border border-border bg-white/[0.04] px-4 text-sm font-semibold text-muted-foreground transition hover:text-foreground focus-visible:ring-3 focus-visible:ring-[var(--voltflow-cyan)]/30"
        >
          Главная
        </Link>
        <button
          type="button"
          onClick={copyLink}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-white/[0.04] px-4 text-sm font-semibold text-[var(--voltflow-cyan)] transition hover:bg-white/[0.07] focus-visible:ring-3 focus-visible:ring-[var(--voltflow-cyan)]/30"
        >
          <Clipboard className="size-4" aria-hidden />
          {copyStatus === "copied"
            ? "Скопировано"
            : copyStatus === "unavailable"
              ? "Копирование недоступно"
              : "Скопировать"}
        </button>
      </div>

      <header className="voltflow-card p-5">
        <Link
          href={`/telegram/category/${article.categorySlug}`}
          className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--voltflow-green)]"
        >
          {article.category}
        </Link>
        <h1 className="mt-2 font-heading text-3xl font-bold leading-tight">
          {article.title}
        </h1>
        <p className="mt-4 rounded-lg border border-border bg-white/[0.03] p-4 text-base leading-7 text-muted-foreground">
          {article.summary}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {article.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-border bg-white/[0.03] px-3 py-1 text-xs font-semibold text-muted-foreground"
            >
              {tag}
            </span>
          ))}
        </div>
        {article.updatedAt || article.sourceLabel ? (
          <p className="mt-4 text-xs leading-5 text-muted-foreground">
            {article.updatedAt ? `Обновлено ${article.updatedAt}` : null}
            {article.updatedAt && article.sourceLabel ? " · " : null}
            {article.sourceLabel ?? null}
          </p>
        ) : null}
      </header>

      {images.length ? (
        <section className="space-y-3" aria-label="Фотографии статьи">
          <button
            type="button"
            onClick={() => {
              setActiveImage(0);
              setGalleryOpen(true);
            }}
            className="block w-full overflow-hidden rounded-lg border border-border text-left"
          >
            <Image
              src={images[0].url}
              alt={images[0].alt || article.title}
              width={800}
              height={450}
              unoptimized
              priority
              className="aspect-[16/9] w-full object-cover"
            />
          </button>
          {images.length > 1 ? (
            <div className="grid grid-cols-4 gap-2">
              {images.slice(1, 5).map((image, index) => (
                <button
                  key={`${image.url}-${index}`}
                  type="button"
                  onClick={() => {
                    setActiveImage(index + 1);
                    setGalleryOpen(true);
                  }}
                  className="overflow-hidden rounded-lg border border-border"
                >
                  <Image
                    src={image.url}
                    alt={image.alt || article.title}
                    width={180}
                    height={120}
                    unoptimized
                    className="aspect-[4/3] w-full object-cover"
                  />
                </button>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="space-y-3">
        {article.sections.map((section) => (
          <section key={section.heading} className="voltflow-card p-5">
            <h2 className="font-heading text-xl font-bold">{section.heading}</h2>
            <p className="mt-3 text-sm leading-7 text-muted-foreground">
              {section.body}
            </p>
          </section>
        ))}
      </div>

      {article.tips?.length ? (
        <section className="space-y-2" aria-label="Практичные советы">
          <h2 className="font-heading text-xl font-bold">Практичные советы</h2>
          {article.tips.map((tip) => (
            <div
              key={tip}
              className="flex gap-2 rounded-lg border border-[var(--voltflow-cyan)]/25 bg-[var(--voltflow-cyan)]/10 p-4 text-sm leading-6 text-cyan-50"
            >
              <Lightbulb className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{tip}</span>
            </div>
          ))}
        </section>
      ) : null}

      {article.warnings?.length ? (
        <section className="space-y-2" aria-label="Предупреждения">
          <h2 className="font-heading text-xl font-bold">Предупреждения</h2>
          {article.warnings.map((warning) => (
            <div
              key={warning}
              className="flex gap-2 rounded-lg border border-amber-400/30 bg-amber-400/10 p-4 text-sm leading-6 text-amber-100"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{warning}</span>
            </div>
          ))}
        </section>
      ) : null}

      {relatedArticles.length ? (
        <section className="space-y-2" aria-label="Связанные статьи">
          <h2 className="font-heading text-xl font-bold">Связанные статьи</h2>
          {relatedArticles.map((related) => (
            <Link
              key={related.id}
              href={`/telegram/article/${related.slug}`}
              className="voltflow-card block p-4 transition hover:border-[var(--voltflow-cyan)]/60 focus-visible:ring-3 focus-visible:ring-[var(--voltflow-cyan)]/30"
            >
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--voltflow-green)]">
                {related.category}
              </p>
              <h3 className="mt-1 font-heading text-base font-bold">
                {related.title}
              </h3>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {related.summary}
              </p>
            </Link>
          ))}
        </section>
      ) : null}

      {galleryOpen && images.length ? (
        <div className="fixed inset-0 z-[80] bg-black/80 p-4 backdrop-blur-sm">
          <div className="mx-auto flex h-full max-w-[430px] flex-col justify-center">
            <div className="rounded-lg border border-border bg-card p-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="min-w-0 truncate text-sm font-bold">{article.title}</p>
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
                src={images[activeImage].url}
                alt={images[activeImage].alt || article.title}
                width={800}
                height={600}
                unoptimized
                className="max-h-[70dvh] w-full rounded-lg object-contain"
              />
              {images.length > 1 ? (
                <div className="mt-3 flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => moveImage(-1)}
                    className="grid size-10 place-items-center rounded-lg border border-border"
                    aria-label="Предыдущее фото"
                  >
                    <ChevronLeft className="size-5" aria-hidden />
                  </button>
                  <span className="text-sm font-semibold text-muted-foreground">
                    {activeImage + 1} / {images.length}
                  </span>
                  <button
                    type="button"
                    onClick={() => moveImage(1)}
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
