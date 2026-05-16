import type {
  AccessoryItem as TelegramAccessoryItem,
  FAQItem as TelegramFAQItem,
  KnowledgeArticle as TelegramKnowledgeArticle,
} from "@/types/telegram";

export type ArticleStatus = "draft" | "published" | "archived";
export type AccessoryPriority = "must-have" | "useful" | "optional";

export type KnowledgeArticleSection = {
  heading: string;
  body: string;
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
  tips: string[];
  warnings: string[];
  tags: string[];
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
  external_url: string | null;
  status: ArticleStatus;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type ArticleInput = {
  slug: string;
  title: string;
  summary: string | null;
  category_id: string;
  content: KnowledgeArticleSection[];
  tips: string[];
  warnings: string[];
  tags: string[];
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
  external_url: string | null;
  status: ArticleStatus;
  sort_order: number;
};

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
};
