import type { CarGeneration } from "@/lib/car-generations";
import type {
  AccessoryItem as TelegramAccessoryItem,
  FAQItem as TelegramFAQItem,
  KnowledgeArticle as TelegramKnowledgeArticle,
} from "@/types/telegram";

export type ArticleStatus = "draft" | "published" | "archived";
export type AccessoryPriority = "must-have" | "useful" | "optional";

export type AccessoryExternalLink = {
  label: string;
  url: string;
};

export type SparePartImage = {
  url: string;
  alt: string;
};

export type KnowledgeArticleSection = {
  heading: string;
  body: string;
  images?: SparePartImage[];
};

export type KnowledgeCategory = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type KnowledgeArticle = {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  category_id: string | null;
  category?: KnowledgeCategory | null;
  content: KnowledgeArticleSection[];
  images: SparePartImage[];
  tips: string[];
  warnings: string[];
  tags: string[];
  model_generations: CarGeneration[];
  status: ArticleStatus;
  source_label: string | null;
  sort_order: number;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  related_article_ids?: string[];
};

export type FAQItem = {
  id: string;
  question: string;
  answer: string;
  category_id: string | null;
  category?: KnowledgeCategory | null;
  tags: string[];
  model_generations: CarGeneration[];
  status: ArticleStatus;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type AccessoryItem = {
  id: string;
  title: string;
  category_id: string | null;
  category?: KnowledgeCategory | null;
  use_case: string | null;
  why_useful: string | null;
  what_to_check: string[];
  priority: AccessoryPriority;
  risk_notes: string[];
  search_keywords: string[];
  model_generations: CarGeneration[];
  external_url: string | null;
  external_links: AccessoryExternalLink[];
  image_url: string | null;
  image_alt: string | null;
  status: ArticleStatus;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type SparePartItem = {
  id: string;
  title: string;
  description: string | null;
  category_id: string | null;
  category?: KnowledgeCategory | null;
  part_number: string | null;
  compatibility: string | null;
  external_links: AccessoryExternalLink[];
  images: SparePartImage[];
  search_keywords: string[];
  model_generations: CarGeneration[];
  status: ArticleStatus;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type ServiceProviderLink = {
  label: string;
  url: string;
};

export type ServiceProviderItem = {
  id: string;
  name: string;
  provider_type: "service_center" | "mobile_service" | "detailer" | "parts_and_service" | "other";
  city: string | null;
  service_area: string | null;
  description: string | null;
  services: string[];
  price_from: number | null;
  currency: string;
  external_links: ServiceProviderLink[];
  model_generations: CarGeneration[];
  image_url: string | null;
  image_alt: string | null;
  status: ArticleStatus;
  sort_order: number;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ArticleInput = {
  slug: string;
  title: string;
  summary: string | null;
  category_id: string;
  content: KnowledgeArticleSection[];
  images: SparePartImage[];
  tips: string[];
  warnings: string[];
  tags: string[];
  model_generations: CarGeneration[];
  status: ArticleStatus;
  source_label: string | null;
  sort_order: number;
  related_article_ids?: string[];
};

export type FAQInput = {
  question: string;
  answer: string;
  category_id: string;
  tags: string[];
  model_generations: CarGeneration[];
  status: ArticleStatus;
  sort_order: number;
};

export type AccessoryInput = {
  title: string;
  category_id: string;
  use_case: string | null;
  why_useful: string | null;
  what_to_check: string[];
  priority: AccessoryPriority;
  risk_notes: string[];
  search_keywords: string[];
  model_generations: CarGeneration[];
  external_url: string | null;
  external_links: AccessoryExternalLink[];
  image_url: string | null;
  image_alt: string | null;
  status: ArticleStatus;
  sort_order: number;
};

export type SparePartInput = {
  title: string;
  description: string | null;
  category_id: string;
  part_number: string | null;
  compatibility: string | null;
  external_links: AccessoryExternalLink[];
  images: SparePartImage[];
  search_keywords: string[];
  model_generations: CarGeneration[];
  status: ArticleStatus;
  sort_order: number;
};

export type ServiceProviderInput = Omit<
  ServiceProviderItem,
  "id" | "created_at" | "updated_at"
>;

export type CategoryInput = {
  slug: string;
  title: string;
  description: string | null;
  sort_order: number;
};

export type TelegramKnowledgeData = {
  categories: {
    slug: string;
    title: string;
    description: string;
  }[];
  articles: TelegramKnowledgeArticle[];
  faq: TelegramFAQItem[];
  accessories: TelegramAccessoryItem[];
  spareParts: SparePartItem[];
  serviceProviders: ServiceProviderItem[];
};
