import type { Metadata } from "next";
import Link from "next/link";

import { AccessoryCard, ArticleCard } from "@/components/telegram/ArticleCard";
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

  return {
    title: category ? `${category.title} Knowledge` : "Category not found",
    description: category?.description,
    openGraph: {
      title: category ? `${category.title} · VoltFlow` : "Category not found",
      description: category?.description,
    },
  };
}

export default async function TelegramCategoryPage({ params }: PageProps) {
  const { slug } = await params;
  const data = await getTelegramKnowledgeDataWithFallback(staticTelegramKnowledgeData);
  const category = data.categories.find((item) => item.slug === slug) ?? getCategoryBySlug(slug);
  const fallbackContent = getCategoryContent(slug);
  const content = {
    articles: data.articles.filter((article) => article.categorySlug === slug),
    faq: data.faq.filter((item) => item.categorySlug === slug),
    accessories: data.accessories.filter((item) => item.categorySlug === slug),
  };
  const safeContent =
    content.articles.length || content.faq.length || content.accessories.length
      ? content
      : fallbackContent;

  return (
    <main className="relative isolate min-h-dvh overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_-8%,rgba(0,209,255,0.24),transparent_26rem),radial-gradient(circle_at_8%_18%,rgba(0,230,118,0.14),transparent_20rem),linear-gradient(180deg,rgba(18,21,28,0)_0%,#12151C_78%)]" />
      <div className="mobile-page relative min-h-dvh space-y-5 px-4 pb-[calc(env(safe-area-inset-bottom)+2rem)] pt-[calc(env(safe-area-inset-top)+1rem)]">
        <Link
          href="/telegram"
          className="inline-flex min-h-11 items-center rounded-lg border border-border bg-white/[0.04] px-4 text-sm font-semibold text-muted-foreground"
        >
          Back to home
        </Link>

        {category ? (
          <>
            <header className="voltflow-card p-5">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--voltflow-cyan)]">
                Category
              </p>
              <h1 className="mt-2 font-heading text-3xl font-bold">
                {category.title}
              </h1>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                {category.description}
              </p>
            </header>

            {safeContent.articles.length ? (
              <section className="space-y-3" aria-label="Articles">
                <h2 className="font-heading text-xl font-bold">Articles</h2>
                {safeContent.articles.map((article) => (
                  <ArticleCard key={article.id} article={article} />
                ))}
              </section>
            ) : null}

            {safeContent.faq.length ? (
              <section className="space-y-3" aria-label="FAQ">
                <h2 className="font-heading text-xl font-bold">FAQ</h2>
                {safeContent.faq.map((item) => (
                  <article key={item.id} className="voltflow-card p-4">
                    <h3 className="font-heading text-base font-bold">
                      {item.question}
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {item.answer}
                    </p>
                  </article>
                ))}
              </section>
            ) : null}

            {safeContent.accessories.length ? (
              <section className="space-y-3" aria-label="Accessories">
                <h2 className="font-heading text-xl font-bold">Accessories</h2>
                {safeContent.accessories.map((item) => (
                  <AccessoryCard key={item.id} item={item} />
                ))}
              </section>
            ) : null}

            {!safeContent.articles.length &&
            !safeContent.faq.length &&
            !safeContent.accessories.length ? (
              <div className="voltflow-card p-4 text-sm leading-6 text-muted-foreground">
                This category is prepared for Phase 1.5, but content has not
                been added yet.
              </div>
            ) : null}
          </>
        ) : (
          <section className="voltflow-card p-5">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--voltflow-cyan)]">
              Category not found
            </p>
            <h1 className="mt-2 font-heading text-2xl font-bold">
              This category does not exist
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Try charging, ownership, maintenance, accessories, battery, winter,
              safety, or costs.
            </p>
          </section>
        )}
      </div>
    </main>
  );
}
