import type { Metadata } from "next";
import { Suspense } from "react";

import { KnowledgeChrome } from "@/components/knowledge/KnowledgeChrome";
import { KnowledgeHeader } from "@/components/knowledge/KnowledgeHeader";
import { KnowledgeIndex } from "@/components/telegram/KnowledgeIndex";
import { JsonLd, collectionPageSchema } from "@/lib/seo/json-ld";
import { openGraph } from "@/lib/seo/open-graph";
import { createPublicClient } from "@/lib/supabase/public";
import { getTelegramKnowledgeDataWithFallback } from "@/lib/supabase/knowledge";
import { staticTelegramKnowledgeData } from "@/lib/telegram/knowledge";

export const metadata: Metadata = {
  title: "База знаний BYD YUAN UP",
  description:
    "Русская база знаний VoltFlow для BYD YUAN UP: зарядка, обслуживание, аксессуары, калькуляторы и опыт эксплуатации.",
  // KnowledgeChrome.changeTab pushes ?tab=guides|faq|buy|more into the URL, which
  // otherwise yields four indexable copies of this page.
  alternates: { canonical: "/knowledge" },
  openGraph: openGraph({
    url: "/knowledge",
    title: "VoltFlow: база знаний BYD YUAN UP",
    description: "Русская база знаний VoltFlow для владельцев BYD YUAN UP.",
    type: "website",
  }),
};

// Statically rendered, refreshed hourly.
export const revalidate = 3600;

export default async function KnowledgePage() {
  const data = await getTelegramKnowledgeDataWithFallback(
    staticTelegramKnowledgeData,
    createPublicClient(),
  );

  return (
    <main className="relative isolate min-h-dvh overflow-x-hidden scroll-smooth bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_-8%,rgba(0,209,255,0.16),transparent_22rem),linear-gradient(180deg,rgba(18,21,28,0)_0%,#12151C_72%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px voltflow-gradient" />

      <JsonLd
        data={collectionPageSchema({
          name: "База знаний BYD YUAN UP",
          description:
            "Гайды по зарядке, обслуживанию и аксессуарам для владельцев BYD YUAN UP.",
          path: "/knowledge",
          items: data.articles.map((article) => ({
            title: article.title,
            path: `/knowledge/article/${article.slug}`,
          })),
        })}
      />

      <div className="mobile-page relative min-h-dvh px-3 pb-[calc(env(safe-area-inset-bottom)+5.75rem)] pt-[calc(env(safe-area-inset-top)+0.5rem)]">
        {/*
          KnowledgeHeader (the <h1>) and KnowledgeIndex (the crawlable link tree)
          sit OUTSIDE the Suspense boundary on purpose. KnowledgeChrome calls
          useSearchParams(), so static rendering prerenders `fallback={null}` and
          defers everything inside it to the client. With the heading in there,
          the prerendered HTML had 29 links and no <h1>.
        */}
        <KnowledgeHeader />

        <Suspense fallback={null}>
          <KnowledgeChrome data={data} />
        </Suspense>

        <KnowledgeIndex data={data} />
      </div>
    </main>
  );
}
