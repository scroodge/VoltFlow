import { accessories } from "@/data/telegram/accessories";
import { faqItems } from "@/data/telegram/faq";
import { allArticles } from "@/lib/telegram/knowledge";
import type { TelegramKnowledgeData } from "@/types/knowledge";

export type SearchResult = {
  id: string;
  type: "article" | "faq" | "accessory";
  title: string;
  summary: string;
  category: string;
  categorySlug: string;
  score: number;
  href?: string;
};

type SearchIndexItem = SearchResult & {
  titleText: string;
  tagText: string;
  summaryText: string;
  bodyText: string;
  keywordText: string;
  categoryText: string;
};

const dynamicIndexCache = new WeakMap<
  Pick<TelegramKnowledgeData, "articles" | "faq" | "accessories">,
  SearchIndexItem[]
>();

const index = buildIndex({
  articles: allArticles,
  faq: faqItems,
  accessories,
});

export function searchTelegramKnowledge(
  query: string,
  limit = 12,
  data?: Pick<TelegramKnowledgeData, "articles" | "faq" | "accessories">,
): SearchResult[] {
  const terms = normalizeQuery(query);

  if (terms.length === 0) return [];

  const searchIndex = data ? getDynamicIndex(data) : index;

  return searchIndex
    .map((item) => {
      const score = terms.reduce((total, term) => {
        return (
          total +
          scoreField(item.titleText, term, 12) +
          scoreField(item.tagText, term, 8) +
          scoreField(item.keywordText, term, 7) +
          scoreField(item.summaryText, term, 5) +
          scoreField(item.bodyText, term, 2) +
          scoreField(item.categoryText, term, 3)
        );
      }, 0);

      return { item, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title))
    .slice(0, limit)
    .map(({ item, score }) => ({
      id: item.id,
      type: item.type,
      title: item.title,
      summary: item.summary,
      category: item.category,
      categorySlug: item.categorySlug,
      score,
      href: item.href,
    }));
}

function getDynamicIndex(
  data: Pick<TelegramKnowledgeData, "articles" | "faq" | "accessories">,
) {
  const cached = dynamicIndexCache.get(data);
  if (cached) return cached;

  const nextIndex = buildIndex(data);
  dynamicIndexCache.set(data, nextIndex);

  return nextIndex;
}

function buildIndex(data: Pick<TelegramKnowledgeData, "articles" | "faq" | "accessories">): SearchIndexItem[] {
  return [
    ...data.articles.map((article) =>
      createIndexItem({
        id: article.slug,
        type: "article",
        title: article.title,
        summary: article.summary,
        category: article.category,
        categorySlug: article.categorySlug,
        href: `/telegram/article/${article.slug}`,
        titleText: article.title,
        tagText: article.tags.join(" "),
        summaryText: article.summary,
        bodyText: [
          article.sections
            .map((section) => `${section.heading} ${section.body}`)
            .join(" "),
          article.tips?.join(" "),
          article.warnings?.join(" "),
        ].join(" "),
        keywordText: "",
      }),
    ),
    ...data.faq.map((item) =>
      createIndexItem({
        id: item.id,
        type: "faq",
        title: item.question,
        summary: item.answer,
        category: item.category,
        categorySlug: item.categorySlug,
        href: `/telegram?tab=faq&q=${encodeURIComponent(item.question)}`,
        titleText: item.question,
        tagText: item.tags.join(" "),
        summaryText: "",
        bodyText: item.answer,
        keywordText: "",
      }),
    ),
    ...data.accessories.map((item) =>
      createIndexItem({
        id: item.id,
        type: "accessory",
        title: item.title,
        summary: item.whyUseful,
        category: item.category,
        categorySlug: item.categorySlug,
        href: `/telegram/category/${item.categorySlug}?q=${encodeURIComponent(item.title)}`,
        titleText: item.title,
        tagText: item.category,
        summaryText: `${item.useCase} ${item.whyUseful}`,
        bodyText: [
          item.whatToCheckBeforeBuying.join(" "),
          item.riskNotes?.join(" "),
          item.priority,
        ].join(" "),
        keywordText: item.searchKeywords.join(" "),
      }),
    ),
  ];
}

function createIndexItem(item: Omit<SearchIndexItem, "score" | "categoryText">): SearchIndexItem {
  return {
    ...item,
    score: 0,
    titleText: normalizeText(item.titleText),
    tagText: normalizeText(item.tagText),
    summaryText: normalizeText(item.summaryText),
    bodyText: normalizeText(item.bodyText),
    keywordText: normalizeText(item.keywordText),
    categoryText: normalizeText(item.category),
  };
}

export function highlightSearchMatch(text: string, query: string) {
  const term = normalizeQuery(query)[0];
  if (!term) return text;

  const indexOfMatch = normalizeText(text).indexOf(term);
  if (indexOfMatch < 0) return text;

  return {
    before: text.slice(0, indexOfMatch),
    match: text.slice(indexOfMatch, indexOfMatch + term.length),
    after: text.slice(indexOfMatch + term.length),
  };
}

function normalizeQuery(query: string) {
  return normalizeText(query).split(" ").filter(Boolean);
}

function normalizeText(text: string) {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function scoreField(normalizedText: string | undefined, term: string, weight: number) {
  if (!normalizedText) return 0;

  if (normalizedText === term) return weight * 3;
  if (normalizedText.startsWith(term)) return weight * 2;
  if (normalizedText.includes(term)) return weight;

  return 0;
}
