import type { MetadataRoute } from "next";

import { legalDocuments } from "@/lib/legal-region";
import { siteUrl } from "@/lib/site-url";
import { createPublicClient } from "@/lib/supabase/public";
import { staticTelegramKnowledgeData, telegramCategories } from "@/lib/telegram/knowledge";

/**
 * Emitted at `/sitemap.xml`.
 *
 * Two constraints worth knowing before editing this file:
 *
 * 1. It MUST NOT touch a request-time API. Next caches `sitemap.ts` as a route
 *    handler only while that holds, so reading through `@/lib/supabase/server`
 *    (which calls `cookies()`) would silently make it dynamic. Hence
 *    `createPublicClient()`.
 * 2. `src/proxy.ts` must keep excluding `sitemap*.xml` from its matcher, or
 *    this 307s to `/login`.
 *
 * The KB lives at `/knowledge/*`. The old `/telegram/*` forms 308 to these via
 * `redirects()` in next.config.ts and must never appear here — a sitemap must
 * not list redirect sources. `/telegram` itself is the Mini App gate and is
 * `noindex`, so it is absent too.
 */
const KB_BASE = "/knowledge";

export const revalidate = 3600;

type Row = { slug?: string | null; id?: string | null; updated_at?: string | null };

/** Static-corpus articles carry no timestamps; a lastmod that changes every build is
 *  worse than none, so this returns undefined rather than `new Date()`. */
function lastModified(value?: string | null): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function entry(
  path: string,
  priority: number,
  updatedAt?: string | null,
): MetadataRoute.Sitemap[number] {
  const modified = lastModified(updatedAt);
  return {
    url: siteUrl(path),
    priority,
    ...(modified ? { lastModified: modified } : {}),
  };
}

/**
 * Mirrors `getTelegramKnowledgeDataWithFallback`'s fail-soft shape: a database
 * outage yields a smaller sitemap built from the static corpus rather than a
 * 500. Reading the static corpus alone would omit every CMS-authored article,
 * since Postgres is the source of truth and the bundled data is the fallback.
 */
async function readKnowledge() {
  try {
    const supabase = createPublicClient();
    const [articles, categories, accessories, spareParts, serviceProviders] =
      await Promise.all([
        supabase
          .from("knowledge_articles")
          .select("slug, updated_at")
          .eq("status", "published"),
        supabase.from("knowledge_categories").select("slug"),
        supabase.from("accessories").select("id").eq("status", "published"),
        supabase.from("spare_parts").select("id, updated_at").eq("status", "published"),
        supabase
          .from("service_providers")
          .select("id, updated_at")
          .eq("status", "published"),
      ]);

    const articleRows = (articles.data ?? []) as Row[];

    // Same emptiness test the runtime data loader uses: no rows means the DB is
    // unreachable or unseeded, so fall back rather than publish a stub sitemap.
    if (!articleRows.length) throw new Error("no published articles");

    return {
      articles: articleRows,
      categories: (categories.data ?? []) as Row[],
      accessories: (accessories.data ?? []) as Row[],
      spareParts: (spareParts.data ?? []) as Row[],
      serviceProviders: (serviceProviders.data ?? []) as Row[],
    };
  } catch {
    const fallback = staticTelegramKnowledgeData;
    return {
      articles: fallback.articles.map((a) => ({ slug: a.slug, updated_at: a.updatedAtIso })),
      categories: telegramCategories.map((c) => ({ slug: c.slug })),
      accessories: fallback.accessories.map((a) => ({ id: a.id })),
      spareParts: fallback.spareParts.map((s) => ({ id: s.id, updated_at: s.updated_at })),
      serviceProviders: fallback.serviceProviders.map((s) => ({
        id: s.id,
        updated_at: s.updated_at,
      })),
    };
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const kb = await readKnowledge();

  const newestArticle = kb.articles
    .map((a) => a.updated_at)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);

  return [
    entry("/", 1),
    entry(KB_BASE, 0.9, newestArticle),
    entry("/support", 0.3),

    ...kb.categories
      .filter((c) => c.slug)
      .map((c) => entry(`${KB_BASE}/category/${c.slug}`, 0.7)),

    ...kb.articles
      .filter((a) => a.slug)
      .map((a) => entry(`${KB_BASE}/article/${a.slug}`, 0.8, a.updated_at)),

    // Accessories carry no updated_at in the app-facing shape, so no lastmod.
    ...kb.accessories
      .filter((a) => a.id)
      .map((a) => entry(`${KB_BASE}/accessory/${a.id}`, 0.5)),

    ...kb.spareParts
      .filter((s) => s.id)
      .map((s) => entry(`${KB_BASE}/spare-part/${s.id}`, 0.5, s.updated_at)),

    ...kb.serviceProviders
      .filter((s) => s.id)
      .map((s) => entry(`${KB_BASE}/service/${s.id}`, 0.4, s.updated_at)),

    // Only the `world` region: `/legal/:doc/belarus` redirects here, and a
    // sitemap must never list a redirect source.
    ...legalDocuments.map((document) => entry(`/legal/${document}/world`, 0.2)),
  ];
}
