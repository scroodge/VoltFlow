import { ExternalLink } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import type { AccessoryItem, KnowledgeArticle } from "@/types/telegram";

type ArticleCardProps = {
  article: KnowledgeArticle;
};

export function ArticleCard({ article }: ArticleCardProps) {
  return (
    <Link
      href={`/telegram/article/${article.slug}`}
      className="voltflow-card block p-4 transition hover:border-[var(--voltflow-cyan)]/60 focus-visible:ring-3 focus-visible:ring-[var(--voltflow-cyan)]/30"
    >
      <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--voltflow-green)]">
        {article.category}
      </span>
      <span className="mt-1 block font-heading text-lg font-bold leading-snug">
        {article.title}
      </span>
      <span className="mt-2 block text-sm leading-6 text-muted-foreground">
        {article.summary}
      </span>
      <span className="mt-3 block text-xs font-semibold text-[var(--voltflow-cyan)]">
        Открыть статью
      </span>
    </Link>
  );
}

export function AccessoryCard({ item }: { item: AccessoryItem }) {
  const priorityLabel = {
    "must-have": "Обязательно",
    useful: "Полезно",
    optional: "Опционально",
  }[item.priority];
  const links =
    item.externalLinks?.length
      ? item.externalLinks
      : item.externalUrl
        ? [{ label: "Открыть ссылку", url: item.externalUrl }]
        : [];

  return (
    <article className="voltflow-card p-4">
      {item.imageUrl ? (
        <Image
          src={item.imageUrl}
          alt={item.imageAlt ?? item.title}
          width={640}
          height={360}
          unoptimized
          className="mb-4 aspect-[16/9] w-full rounded-lg border border-border object-cover"
        />
      ) : null}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--voltflow-green)]">
            {item.category}
          </p>
          <h3 className="mt-1 font-heading text-lg font-bold">{item.title}</h3>
        </div>
        <span className="shrink-0 rounded-full border border-border bg-white/[0.04] px-3 py-1 text-xs font-bold text-[var(--voltflow-cyan)]">
          {priorityLabel}
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        {item.useCase}
      </p>
      <p className="mt-2 text-sm leading-6 text-foreground">{item.whyUseful}</p>
      <div className="mt-4">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
          Проверить перед покупкой
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {item.whatToCheckBeforeBuying.map((check) => (
            <span
              key={check}
              className="rounded-full border border-border bg-white/[0.03] px-3 py-1 text-xs text-muted-foreground"
            >
              {check}
            </span>
          ))}
        </div>
      </div>
      {item.riskNotes?.length ? (
        <div className="mt-4 space-y-2">
          {item.riskNotes.map((note) => (
            <div
              key={note}
              className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-sm leading-6 text-amber-100"
            >
              {note}
            </div>
          ))}
        </div>
      ) : null}
      {links.length ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {links.map((link) => (
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
    </article>
  );
}
