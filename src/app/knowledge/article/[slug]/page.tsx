import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";

import { ArticleRenderer } from "@/components/telegram/ArticleRenderer";
import { ArticleViewTracker } from "@/components/telegram/ArticleViewTracker";
import { JsonLd, articleSchema, breadcrumbSchema } from "@/lib/seo/json-ld";
import { openGraph } from "@/lib/seo/open-graph";
import { createPublicClient } from "@/lib/supabase/public";
import { getTelegramKnowledgeDataWithFallback } from "@/lib/supabase/knowledge";
import {
  allArticles,
  getArticleBySlug,
  staticTelegramKnowledgeData,
} from "@/lib/telegram/knowledge";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export const revalidate = 3600;
export const dynamicParams = true;

/**
 * `generateMetadata` and the page body each need the corpus. Without `cache()`
 * that is two identical round trips per render.
 */
const loadKnowledge = cache(() =>
  getTelegramKnowledgeDataWithFallback(staticTelegramKnowledgeData, createPublicClient()),
);

export async function generateStaticParams() {
  // Prebuild DB slugs, not just the bundled fallback corpus — mapping
  // `allArticles` alone meant CMS-authored articles were never prerendered.
  // Union with the static list so a DB outage at build time still yields pages.
  const data = await loadKnowledge();
  const slugs = new Set([
    ...data.articles.map((article) => article.slug),
    ...allArticles.map((article) => article.slug),
  ]);
  return [...slugs].map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const data = await loadKnowledge();
  const articleBySlug = new Map(data.articles.map((item) => [item.slug, item]));
  const article = articleBySlug.get(slug) ?? getArticleBySlug(slug);

  if (!article) {
    // The page itself calls notFound(), so this branch is belt-and-braces.
    return {
      title: "Статья не найдена",
      robots: { index: false, follow: false },
    };
  }

  return {
    title: article.title,
    description: article.summary,
    alternates: { canonical: `/knowledge/article/${slug}` },
    openGraph: openGraph({
      url: `/knowledge/article/${slug}`,
      title: `${article.title} · VoltFlow`,
      description: article.summary,
      type: "article",
      publishedTime: article.publishedAtIso,
      modifiedTime: article.updatedAtIso,
      tags: article.tags,
    }),
  };
}

export default async function TelegramArticlePage({ params }: PageProps) {
  const { slug } = await params;
  const data = await loadKnowledge();
  const articleBySlug = new Map(data.articles.map((item) => [item.slug, item]));
  const articleById = new Map(data.articles.map((item) => [item.id, item]));
  const article = articleBySlug.get(slug) ?? getArticleBySlug(slug);

  // A missing article must be a real 404. Rendering a "not found" card with
  // HTTP 200 is a soft 404: every stale or typo'd link becomes an indexable
  // near-duplicate thin page and burns crawl budget.
  if (!article) notFound();

  const relatedArticles = (article.relatedIds ?? [])
    .map((id) => articleById.get(id))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  return (
    <main className="relative isolate min-h-dvh overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_-8%,rgba(0,209,255,0.24),transparent_26rem),radial-gradient(circle_at_8%_18%,rgba(0,230,118,0.14),transparent_20rem),linear-gradient(180deg,rgba(18,21,28,0)_0%,#12151C_78%)]" />
      <div className="mobile-page relative min-h-dvh px-4 pb-[calc(env(safe-area-inset-bottom)+2rem)] pt-[calc(env(safe-area-inset-top)+1rem)]">
        <JsonLd data={articleSchema(article, `/knowledge/article/${slug}`)} />
        <JsonLd
          data={breadcrumbSchema([
            { name: "Главная", path: "/" },
            { name: "База знаний", path: "/knowledge" },
            {
              name: article.category,
              path: `/knowledge/category/${article.categorySlug}`,
            },
            { name: article.title, path: `/knowledge/article/${slug}` },
          ])}
        />
        <ArticleViewTracker slug={article.slug} />
        <ArticleRenderer article={article} relatedArticles={relatedArticles} />
      </div>
    </main>
  );
}
