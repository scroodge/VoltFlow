import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { TelegramCategoryView } from "@/components/telegram/TelegramCategoryView";
import {
  JsonLd,
  breadcrumbSchema,
  collectionPageSchema,
} from "@/lib/seo/json-ld";
import { openGraph } from "@/lib/seo/open-graph";
import { getTelegramKnowledgeDataWithFallback } from "@/lib/supabase/knowledge";
import {
  getCategoryBySlug,
  getCategoryContent,
  staticTelegramKnowledgeData,
  telegramCategories,
} from "@/lib/telegram/knowledge";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateStaticParams() {
  return telegramCategories.map((category) => ({ slug: category.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const data = await getTelegramKnowledgeDataWithFallback(staticTelegramKnowledgeData);
  const category = data.categories.find((item) => item.slug === slug) ?? getCategoryBySlug(slug);

  if (!category) {
    // The page itself calls notFound(), so this branch is belt-and-braces.
    return { title: "Раздел не найден", robots: { index: false, follow: false } };
  }

  return {
    title: `${category.title} · База знаний`,
    description: category.description,
    alternates: { canonical: `/telegram/category/${slug}` },
    openGraph: openGraph({
      type: "website",
      url: `/telegram/category/${slug}`,
      title: `${category.title} · VoltFlow`,
      description: category.description,
    }),
  };
}

export default async function TelegramCategoryPage({ params }: PageProps) {
  const { slug } = await params;
  const data = await getTelegramKnowledgeDataWithFallback(staticTelegramKnowledgeData);
  const category = data.categories.find((item) => item.slug === slug) ?? getCategoryBySlug(slug);

  // Real 404 rather than a 200 "раздел не найден" card — see the article route.
  if (!category) notFound();

  const fallbackContent = getCategoryContent(slug);
  const content = {
    articles: data.articles.filter((article) => article.categorySlug === slug),
    faq: data.faq.filter((item) => item.categorySlug === slug),
    accessories: data.accessories.filter((item) => item.categorySlug === slug),
    spareParts: data.spareParts.filter(() => slug === "spare-parts"),
  };
  const safeContent =
    content.articles.length ||
    content.faq.length ||
    content.accessories.length ||
    content.spareParts.length
      ? content
      : { ...fallbackContent, spareParts: [] };

  return (
    <main className="relative isolate min-h-dvh overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_-8%,rgba(0,209,255,0.24),transparent_26rem),radial-gradient(circle_at_8%_18%,rgba(0,230,118,0.14),transparent_20rem),linear-gradient(180deg,rgba(18,21,28,0)_0%,#12151C_78%)]" />
      <div className="mobile-page relative min-h-dvh space-y-5 px-4 pb-[calc(env(safe-area-inset-bottom)+2rem)] pt-[calc(env(safe-area-inset-top)+1rem)]">
        <JsonLd
          data={collectionPageSchema({
            name: category.title,
            description: category.description,
            path: `/telegram/category/${slug}`,
            items: safeContent.articles.map((item) => ({
              title: item.title,
              path: `/telegram/article/${item.slug}`,
            })),
          })}
        />
        <JsonLd
          data={breadcrumbSchema([
            { name: "Главная", path: "/" },
            { name: "База знаний", path: "/telegram" },
            { name: category.title, path: `/telegram/category/${slug}` },
          ])}
        />
        {/*
          GenerationFilteredArticles hides articles tagged for a non-default
          generation, so the shell alone never links the whole category. This
          unconditional list is the crawlable path to every article in it, and
          it lives outside the Suspense boundary so it survives static render.
        */}
        {safeContent.articles.length ? (
          <nav
            aria-label={`Все статьи: ${category.title}`}
            className="border-t border-border/60 pt-5"
          >
            <h2 className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--voltflow-cyan)]">
              Все статьи раздела
            </h2>
            <ul className="mt-2 space-y-1">
              {safeContent.articles.map((item) => (
                <li key={item.slug}>
                  <Link
                    href={`/telegram/article/${item.slug}`}
                    className="text-sm leading-6 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                  >
                    {item.title}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
        <Suspense fallback={null}>
          <TelegramCategoryView
            category={{
              slug: category.slug,
              title: category.title,
              description: category.description,
            }}
            content={safeContent}
          />
        </Suspense>
      </div>
    </main>
  );
}
