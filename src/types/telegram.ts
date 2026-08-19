import type { CarGeneration } from "@/lib/car-generations";

export type KnowledgeArticle = {
  id: string;
  slug: string;
  title: string;
  category: string;
  categorySlug: string;
  modelGenerations?: CarGeneration[];
  tags: string[];
  summary: string;
  sections: {
    heading: string;
    body: string;
    images?: {
      url: string;
      alt: string;
    }[];
  }[];
  images?: {
    url: string;
    alt: string;
  }[];
  tips?: string[];
  warnings?: string[];
  relatedIds?: string[];
  /** Date-only (YYYY-MM-DD) slice rendered in article UI. Not precise enough for SEO. */
  updatedAt?: string;
  /**
   * Full `knowledge_articles.updated_at` timestamp. Sitemap `lastmod` and OG
   * `article:modified_time`. Absent for static-fallback articles, which carry no
   * timestamps — emit no lastmod for those rather than `new Date()`, since a
   * lastmod that changes every build teaches crawlers to distrust it.
   */
  updatedAtIso?: string;
  /** Full `knowledge_articles.published_at`. OG `article:published_time`. */
  publishedAtIso?: string;
  sourceLabel?: string;
  /** From knowledge_article_views. Absent (static fallback) or 0 = never opened. */
  viewCount?: number;
};

export type FAQItem = {
  id: string;
  question: string;
  answer: string;
  category: string;
  categorySlug: string;
  tags: string[];
  modelGenerations?: CarGeneration[];
  relatedIds?: string[];
};

export type AccessoryPriority = "must-have" | "useful" | "optional";

export type AccessoryExternalLink = {
  label: string;
  url: string;
};

export type AccessoryItem = {
  id: string;
  title: string;
  category: string;
  categorySlug: string;
  useCase: string;
  whyUseful: string;
  whatToCheckBeforeBuying: string[];
  priority: AccessoryPriority;
  riskNotes?: string[];
  searchKeywords: string[];
  modelGenerations?: CarGeneration[];
  externalUrl?: string;
  externalLinks?: AccessoryExternalLink[];
  imageUrl?: string;
  imageAlt?: string;
};
