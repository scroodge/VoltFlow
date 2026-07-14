import { accessories } from "@/data/telegram/accessories";
import { chargingGuides } from "@/data/telegram/charging-guides";
import { faqItems } from "@/data/telegram/faq";
import { maintenanceArticles } from "@/data/telegram/maintenance";
import { ownershipExperienceArticles } from "@/data/telegram/ownership-experience";
import { russianTelegramKnowledgeData } from "@/data/telegram/russian-fallback";
import type { TelegramKnowledgeData } from "@/types/knowledge";
import type { AccessoryItem, FAQItem, KnowledgeArticle } from "@/types/telegram";

export type TelegramCategory = {
  slug: string;
  title: string;
  description: string;
};

export const allArticles: KnowledgeArticle[] = [
  ...chargingGuides,
  ...ownershipExperienceArticles,
  ...maintenanceArticles,
];

export const telegramCategories: TelegramCategory[] = [
  {
    slug: "charging",
    title: "Charging",
    description:
      "Home charging, public charging, battery habits, safety, cables, and troubleshooting.",
  },
  {
    slug: "ownership",
    title: "Ownership",
    description:
      "Real-owner style experience, first-week habits, comfort, consumption, and trip preparation.",
  },
  {
    slug: "maintenance",
    title: "Maintenance",
    description:
      "Owner-level service preparation, symptoms, and safety-aware maintenance notes.",
  },
  {
    slug: "accessories",
    title: "Accessories",
    description:
      "Useful ownership items with priorities, risk notes, and search keywords instead of fake product links.",
  },
  {
    slug: "spare-parts",
    title: "Запчасти",
    description:
      "Каталог запчастей с описанием, изображениями ракурсов и ссылками на товары.",
  },
  {
    slug: "calculators",
    title: "Calculators",
    description: "EV helper tools for charging time, cost, range, and trip planning.",
  },
  {
    slug: "battery",
    title: "Battery",
    description: "Battery care, charging limits, cold weather behavior, and daily habits.",
  },
  {
    slug: "winter",
    title: "Winter",
    description: "Cold-weather charging, range, washer fluid, and winter ownership notes.",
  },
  {
    slug: "safety",
    title: "Safety",
    description: "Electrical, roadside, child-seat, and service safety topics.",
  },
  {
    slug: "costs",
    title: "Costs",
    description: "Home charging cost, tariffs, efficiency, and calculator assumptions.",
  },
  {
    slug: "byd-yuan-up",
    title: "BYD YUAN UP",
    description: "Model-specific ownership and knowledge-base meta topics.",
  },
];

export const staticTelegramKnowledgeData: TelegramKnowledgeData = {
  categories: russianTelegramKnowledgeData.categories,
  articles: russianTelegramKnowledgeData.articles,
  faq: russianTelegramKnowledgeData.faq,
  accessories: russianTelegramKnowledgeData.accessories,
  spareParts: russianTelegramKnowledgeData.spareParts,
  serviceProviders: russianTelegramKnowledgeData.serviceProviders,
};

export function getArticleBySlug(slug: string) {
  return allArticles.find((article) => article.slug === slug);
}

export function getArticleById(id: string) {
  return allArticles.find((article) => article.id === id);
}

export function getRelatedArticles(article: KnowledgeArticle) {
  return (article.relatedIds ?? [])
    .map(getArticleById)
    .filter((item): item is KnowledgeArticle => Boolean(item));
}

export function getCategoryBySlug(slug: string) {
  return telegramCategories.find((category) => category.slug === slug);
}

export function getCategoryContent(slug: string): {
  articles: KnowledgeArticle[];
  faq: FAQItem[];
  accessories: AccessoryItem[];
  spareParts: TelegramKnowledgeData["spareParts"];
} {
  return {
    articles: allArticles.filter((article) => article.categorySlug === slug),
    faq: faqItems.filter((item) => item.categorySlug === slug),
    accessories: accessories.filter((item) => item.categorySlug === slug),
    spareParts: staticTelegramKnowledgeData.spareParts.filter(() => slug === "spare-parts"),
  };
}
