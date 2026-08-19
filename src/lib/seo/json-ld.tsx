import { siteUrl } from "@/lib/site-url";
import { TELEGRAM_MINIAPP_URL } from "@/lib/support";
import type { KnowledgeArticle } from "@/types/telegram";

/**
 * Structured data helpers. One module rather than inline objects per route, so
 * the publisher/organization node stays identical everywhere — schema.org
 * consumers dedupe on `@id`, and drifting copies defeat that.
 *
 * CSP: no nonce is needed today. The ENFORCED policy in `next.config.ts` has no
 * `script-src` and no `default-src`, and the report-only policy carries
 * `unsafe-inline`. But `application/ld+json` IS governed by `script-src` under
 * CSP3 — when the report-only policy is promoted to enforced and
 * `unsafe-inline` dropped, every block here breaks silently and needs a nonce
 * or a sha256 hash. See the note in BACKLOG.md.
 */

const ORGANIZATION_ID = siteUrl("/#organization");
const WEBSITE_ID = siteUrl("/#website");

export function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      // Content is built from our own data, never from user input.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

export function organizationSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": ORGANIZATION_ID,
    name: "VoltFlow",
    url: siteUrl("/"),
    logo: siteUrl("/voltflow-logo.svg"),
    description:
      "Трекер зарядки электромобиля в реальном времени и база знаний для владельцев BYD.",
    sameAs: [TELEGRAM_MINIAPP_URL],
  };
}

export function websiteSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    name: "VoltFlow",
    url: siteUrl("/"),
    inLanguage: "ru",
    publisher: { "@id": ORGANIZATION_ID },
  };
}

export function breadcrumbSchema(trail: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: siteUrl(crumb.path),
    })),
  };
}

/**
 * `TechArticle` rather than `Article`: the corpus is owner-level technical
 * how-to, and TechArticle avoids the NewsArticle-adjacent expectations Google
 * applies to `Article` (author bylines, publisher dates as ranking inputs).
 */
export function articleSchema(article: KnowledgeArticle, path: string) {
  return {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: article.title,
    description: article.summary,
    url: siteUrl(path),
    mainEntityOfPage: { "@type": "WebPage", "@id": siteUrl(path) },
    inLanguage: "ru",
    // Omitted entirely when absent — an invented date is worse than no date.
    ...(article.publishedAtIso ? { datePublished: article.publishedAtIso } : {}),
    ...(article.updatedAtIso ? { dateModified: article.updatedAtIso } : {}),
    ...(article.tags?.length ? { keywords: article.tags.join(", ") } : {}),
    ...(article.images?.[0]?.url ? { image: article.images[0].url } : {}),
    author: { "@id": ORGANIZATION_ID },
    publisher: { "@id": ORGANIZATION_ID },
  };
}

export function collectionPageSchema(options: {
  name: string;
  description?: string;
  path: string;
  items: { title: string; path: string }[];
}) {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: options.name,
    ...(options.description ? { description: options.description } : {}),
    url: siteUrl(options.path),
    inLanguage: "ru",
    isPartOf: { "@id": WEBSITE_ID },
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: options.items.length,
      itemListElement: options.items.map((item, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: item.title,
        url: siteUrl(item.path),
      })),
    },
  };
}
