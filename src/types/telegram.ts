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
  updatedAt?: string;
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
