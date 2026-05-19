import type { Metadata } from "next";
import Link from "next/link";

import { ArticleRenderer } from "@/components/telegram/ArticleRenderer";
import { getTelegramKnowledgeDataWithFallback } from "@/lib/supabase/knowledge";
import {
  allArticles,
  getArticleBySlug,
  staticTelegramKnowledgeData,
} from "@/lib/telegram/knowledge";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateStaticParams() {
  return allArticles.map((article) => ({ slug: article.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const data = await getTelegramKnowledgeDataWithFallback(staticTelegramKnowledgeData);
  const articleBySlug = new Map(data.articles.map((item) => [item.slug, item]));
  const article = articleBySlug.get(slug) ?? getArticleBySlug(slug);

  if (!article) {
    return {
      title: "Статья не найдена",
    };
  }

  return {
    title: article.title,
    description: article.summary,
    openGraph: {
      title: `${article.title} · VoltFlow`,
      description: article.summary,
      type: "article",
    },
  };
}

export default async function TelegramArticlePage({ params }: PageProps) {
  const { slug } = await params;
  const data = await getTelegramKnowledgeDataWithFallback(staticTelegramKnowledgeData);
  const articleBySlug = new Map(data.articles.map((item) => [item.slug, item]));
  const articleById = new Map(data.articles.map((item) => [item.id, item]));
  const article = articleBySlug.get(slug) ?? getArticleBySlug(slug);
  const relatedArticles = (article?.relatedIds ?? [])
    .map((id) => articleById.get(id))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  return (
    <main className="relative isolate min-h-dvh overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_-8%,rgba(0,209,255,0.24),transparent_26rem),radial-gradient(circle_at_8%_18%,rgba(0,230,118,0.14),transparent_20rem),linear-gradient(180deg,rgba(18,21,28,0)_0%,#12151C_78%)]" />
      <div className="mobile-page relative min-h-dvh px-4 pb-[calc(env(safe-area-inset-bottom)+2rem)] pt-[calc(env(safe-area-inset-top)+1rem)]">
        {article ? (
          <ArticleRenderer
            article={article}
            relatedArticles={relatedArticles}
          />
        ) : (
          <section className="voltflow-card p-5">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--voltflow-cyan)]">
              Статья не найдена
            </p>
            <h1 className="mt-2 font-heading text-2xl font-bold">
              Этой статьи пока нет в базе знаний
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Ссылка может быть устаревшей, либо материал еще готовится к публикации.
            </p>
            <Link
              href="/telegram"
              className="mt-5 inline-flex min-h-11 items-center rounded-lg border border-border bg-white/[0.04] px-4 text-sm font-semibold text-[var(--voltflow-cyan)]"
            >
              Вернуться в базу знаний
            </Link>
          </section>
        )}
      </div>
    </main>
  );
}
