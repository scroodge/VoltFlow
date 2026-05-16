import { createClient } from "@/lib/supabase/server";
import type {
  AccessoryInput,
  AccessoryItem,
  ArticleInput,
  FAQInput,
  FAQItem,
  KnowledgeArticle,
  KnowledgeArticleSection,
  KnowledgeCategory,
  TelegramKnowledgeData,
} from "@/types/knowledge";
import type {
  AccessoryItem as TelegramAccessoryItem,
  FAQItem as TelegramFAQItem,
  KnowledgeArticle as TelegramKnowledgeArticle,
} from "@/types/telegram";

type CategoryRelation = KnowledgeCategory | KnowledgeCategory[] | null;

type RawArticle = Omit<KnowledgeArticle, "category" | "content" | "tips" | "warnings"> & {
  content: unknown;
  tips: unknown;
  warnings: unknown;
  knowledge_categories?: CategoryRelation;
};

type RawFAQ = Omit<FAQItem, "category"> & {
  knowledge_categories?: CategoryRelation;
};

type RawAccessory = Omit<AccessoryItem, "category" | "what_to_check" | "risk_notes"> & {
  what_to_check: unknown;
  risk_notes: unknown;
  knowledge_categories?: CategoryRelation;
};

export async function getCurrentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function isCurrentUserAdmin() {
  const user = await getCurrentUser();
  if (!user) return false;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("admin_users")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) return false;
  return Boolean(data);
}

export async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, reason: "unauthenticated" as const };

  const admin = await isCurrentUserAdmin();
  if (!admin) return { ok: false as const, reason: "forbidden" as const };

  return { ok: true as const, user };
}

export async function getCategories() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("knowledge_categories")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("title", { ascending: true });

  if (error) throw error;
  return (data ?? []) as KnowledgeCategory[];
}

export async function getPublishedArticles() {
  return getArticlesByStatus("published");
}

export async function getArticleBySlug(slug: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("knowledge_articles")
    .select("*, knowledge_categories(*)")
    .eq("slug", slug)
    .eq("status", "published")
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return mapArticle(data as RawArticle);
}

export async function getAdminArticles() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("knowledge_articles")
    .select("*, knowledge_categories(*)")
    .order("sort_order", { ascending: true })
    .order("updated_at", { ascending: false });

  if (error) throw error;
  return (data ?? []).map((item) => mapArticle(item as RawArticle));
}

export async function getAdminArticle(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("knowledge_articles")
    .select("*, knowledge_categories(*)")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const article = mapArticle(data as RawArticle);
  const { data: relations } = await supabase
    .from("article_relations")
    .select("related_article_id")
    .eq("article_id", id);

  article.related_article_ids = (relations ?? []).map((row) => row.related_article_id);
  return article;
}

export async function createArticle(input: ArticleInput) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("knowledge_articles")
    .insert(toArticleRow(input))
    .select("id")
    .single();

  if (error) throw error;
  await replaceArticleRelations(data.id, input.related_article_ids ?? []);
  return data.id as string;
}

export async function updateArticle(id: string, input: ArticleInput) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("knowledge_articles")
    .update(toArticleRow(input))
    .eq("id", id);

  if (error) throw error;
  await replaceArticleRelations(id, input.related_article_ids ?? []);
}

export async function deleteArticle(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("knowledge_articles").delete().eq("id", id);
  if (error) throw error;
}

export async function getPublishedFAQ() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("faq_items")
    .select("*, knowledge_categories(*)")
    .eq("status", "published")
    .order("sort_order", { ascending: true })
    .order("question", { ascending: true });

  if (error) throw error;
  return (data ?? []).map((item) => mapFAQ(item as RawFAQ));
}

export async function getAdminFAQ() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("faq_items")
    .select("*, knowledge_categories(*)")
    .order("sort_order", { ascending: true })
    .order("updated_at", { ascending: false });

  if (error) throw error;
  return (data ?? []).map((item) => mapFAQ(item as RawFAQ));
}

export async function getAdminFAQItem(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("faq_items")
    .select("*, knowledge_categories(*)")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data ? mapFAQ(data as RawFAQ) : null;
}

export async function createFAQ(input: FAQInput) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("faq_items")
    .insert(input)
    .select("id")
    .single();

  if (error) throw error;
  return data.id as string;
}

export async function updateFAQ(id: string, input: FAQInput) {
  const supabase = await createClient();
  const { error } = await supabase.from("faq_items").update(input).eq("id", id);
  if (error) throw error;
}

export async function deleteFAQ(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("faq_items").delete().eq("id", id);
  if (error) throw error;
}

export async function getPublishedAccessories() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("accessories")
    .select("*, knowledge_categories(*)")
    .eq("status", "published")
    .order("sort_order", { ascending: true })
    .order("title", { ascending: true });

  if (error) throw error;
  return (data ?? []).map((item) => mapAccessory(item as RawAccessory));
}

export async function getAdminAccessories() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("accessories")
    .select("*, knowledge_categories(*)")
    .order("sort_order", { ascending: true })
    .order("updated_at", { ascending: false });

  if (error) throw error;
  return (data ?? []).map((item) => mapAccessory(item as RawAccessory));
}

export async function getAdminAccessory(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("accessories")
    .select("*, knowledge_categories(*)")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data ? mapAccessory(data as RawAccessory) : null;
}

export async function createAccessory(input: AccessoryInput) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("accessories")
    .insert(input)
    .select("id")
    .single();

  if (error) throw error;
  return data.id as string;
}

export async function updateAccessory(id: string, input: AccessoryInput) {
  const supabase = await createClient();
  const { error } = await supabase.from("accessories").update(input).eq("id", id);
  if (error) throw error;
}

export async function deleteAccessory(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("accessories").delete().eq("id", id);
  if (error) throw error;
}

export async function createCategory(input: {
  slug: string;
  title: string;
  description: string | null;
  sort_order: number;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("knowledge_categories")
    .insert(input)
    .select("id")
    .single();

  if (error) throw error;
  return data.id as string;
}

export async function updateCategory(id: string, input: {
  slug: string;
  title: string;
  description: string | null;
  sort_order: number;
}) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("knowledge_categories")
    .update(input)
    .eq("id", id);

  if (error) throw error;
}

export async function deleteCategory(id: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("knowledge_categories")
    .delete()
    .eq("id", id);

  if (error) throw error;
}

export async function getTelegramKnowledgeDataWithFallback(
  fallback: TelegramKnowledgeData,
) {
  try {
    const [categories, articles, faq, accessories] = await Promise.all([
      getCategories(),
      getPublishedArticles(),
      getPublishedFAQ(),
      getPublishedAccessories(),
    ]);

    if (!articles.length && !faq.length && !accessories.length) return fallback;

    return {
      categories: categories.length
        ? categories.map((category) => ({
            slug: category.slug,
            title: category.title,
            description: category.description ?? "",
          }))
        : fallback.categories,
      articles: articles.length ? articles.map(toTelegramArticle) : fallback.articles,
      faq: faq.length ? faq.map(toTelegramFAQ) : fallback.faq,
      accessories: accessories.length
        ? accessories.map(toTelegramAccessory)
        : fallback.accessories,
    };
  } catch {
    return fallback;
  }
}

async function getArticlesByStatus(status: "published") {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("knowledge_articles")
    .select("*, knowledge_categories(*)")
    .eq("status", status)
    .order("sort_order", { ascending: true })
    .order("title", { ascending: true });

  if (error) throw error;
  return (data ?? []).map((item) => mapArticle(item as RawArticle));
}

async function replaceArticleRelations(articleId: string, relatedIds: string[]) {
  const supabase = await createClient();
  const { error: deleteError } = await supabase
    .from("article_relations")
    .delete()
    .eq("article_id", articleId);

  if (deleteError) throw deleteError;

  const rows = [...new Set(relatedIds)]
    .filter((relatedId) => relatedId && relatedId !== articleId)
    .map((relatedId) => ({
      article_id: articleId,
      related_article_id: relatedId,
    }));

  if (!rows.length) return;
  const { error } = await supabase.from("article_relations").insert(rows);
  if (error) throw error;
}

function toArticleRow(input: ArticleInput) {
  return {
    slug: input.slug,
    title: input.title,
    summary: input.summary,
    category_id: input.category_id,
    content: input.content,
    tips: input.tips,
    warnings: input.warnings,
    tags: input.tags,
    status: input.status,
    source_label: input.source_label,
    sort_order: input.sort_order,
    published_at: input.status === "published" ? new Date().toISOString() : null,
  };
}

function mapArticle(row: RawArticle): KnowledgeArticle {
  return {
    ...row,
    category: firstRelation(row.knowledge_categories),
    content: parseSections(row.content),
    tips: parseStringArray(row.tips),
    warnings: parseStringArray(row.warnings),
    tags: row.tags ?? [],
  };
}

function mapFAQ(row: RawFAQ): FAQItem {
  return {
    ...row,
    category: firstRelation(row.knowledge_categories),
    tags: row.tags ?? [],
  };
}

function mapAccessory(row: RawAccessory): AccessoryItem {
  return {
    ...row,
    category: firstRelation(row.knowledge_categories),
    what_to_check: parseStringArray(row.what_to_check),
    risk_notes: parseStringArray(row.risk_notes),
    search_keywords: row.search_keywords ?? [],
  };
}

function firstRelation(relation: CategoryRelation | undefined) {
  return Array.isArray(relation) ? relation[0] ?? null : relation;
}

function parseSections(value: unknown): KnowledgeArticleSection[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const section = item as Record<string, unknown>;
      return {
        heading: String(section.heading ?? ""),
        body: String(section.body ?? ""),
      };
    })
    .filter(
      (item): item is KnowledgeArticleSection =>
        Boolean(item?.heading.trim()) || Boolean(item?.body.trim()),
    );
}

function parseStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item)).filter(Boolean);
}

function toTelegramArticle(article: KnowledgeArticle): TelegramKnowledgeArticle {
  return {
    id: article.id,
    slug: article.slug,
    title: article.title,
    category: article.category?.title ?? "Knowledge",
    categorySlug: article.category?.slug ?? "knowledge",
    tags: article.tags,
    summary: article.summary ?? "",
    sections: article.content,
    tips: article.tips,
    warnings: article.warnings,
    relatedIds: article.related_article_ids,
    updatedAt: article.updated_at?.slice(0, 10),
    sourceLabel: article.source_label ?? undefined,
  };
}

function toTelegramFAQ(item: FAQItem): TelegramFAQItem {
  return {
    id: item.id,
    question: item.question,
    answer: item.answer,
    category: item.category?.title ?? "FAQ",
    categorySlug: item.category?.slug ?? "faq",
    tags: item.tags,
  };
}

function toTelegramAccessory(item: AccessoryItem): TelegramAccessoryItem {
  return {
    id: item.id,
    title: item.title,
    category: item.category?.title ?? "Accessories",
    categorySlug: item.category?.slug ?? "accessories",
    useCase: item.use_case ?? "",
    whyUseful: item.why_useful ?? "",
    whatToCheckBeforeBuying: item.what_to_check,
    priority: item.priority,
    riskNotes: item.risk_notes,
    searchKeywords: item.search_keywords,
    externalUrl: item.external_url ?? undefined,
  };
}
