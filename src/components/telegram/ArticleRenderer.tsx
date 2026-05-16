"use client";

import { AlertTriangle, ArrowLeft, Clipboard, Lightbulb } from "lucide-react";
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
          Back
        </button>
        <Link
          href="/telegram"
          className="inline-flex min-h-11 items-center rounded-lg border border-border bg-white/[0.04] px-4 text-sm font-semibold text-muted-foreground transition hover:text-foreground focus-visible:ring-3 focus-visible:ring-[var(--voltflow-cyan)]/30"
        >
          Home
        </Link>
        <button
          type="button"
          onClick={copyLink}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-white/[0.04] px-4 text-sm font-semibold text-[var(--voltflow-cyan)] transition hover:bg-white/[0.07] focus-visible:ring-3 focus-visible:ring-[var(--voltflow-cyan)]/30"
        >
          <Clipboard className="size-4" aria-hidden />
          {copyStatus === "copied"
            ? "Copied"
            : copyStatus === "unavailable"
              ? "Copy unavailable"
              : "Copy link"}
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
            {article.updatedAt ? `Updated ${article.updatedAt}` : null}
            {article.updatedAt && article.sourceLabel ? " · " : null}
            {article.sourceLabel ?? null}
          </p>
        ) : null}
      </header>

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
        <section className="space-y-2" aria-label="Practical tips">
          <h2 className="font-heading text-xl font-bold">Practical tips</h2>
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
        <section className="space-y-2" aria-label="Warnings">
          <h2 className="font-heading text-xl font-bold">Warnings</h2>
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
        <section className="space-y-2" aria-label="Related articles">
          <h2 className="font-heading text-xl font-bold">Related articles</h2>
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
    </article>
  );
}
