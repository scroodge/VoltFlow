import { isCarGeneration, type CarGeneration } from "@/lib/car-generations";
import { buildKnowledgeEmbeddingText, createEmbedding } from "@/lib/embeddings";
import { invalidateKnowledgeSearchCache } from "@/lib/knowledge-search";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { normalizeModelGenerations } from "@/lib/telegram/generation";
import { headers } from "next/headers";
import type {
  AccessoryInput,
  AccessoryExternalLink,
  AccessoryItem,
  ArticleInput,
  ArticleStatus,
  FAQInput,
  FAQItem,
  KnowledgeArticle,
  KnowledgeArticleSection,
  KnowledgeCategory,
  SparePartImage,
  SparePartInput,
  SparePartItem,
  TelegramKnowledgeData,
} from "@/types/knowledge";
import type {
  AccessoryItem as TelegramAccessoryItem,
  FAQItem as TelegramFAQItem,
  KnowledgeArticle as TelegramKnowledgeArticle,
} from "@/types/telegram";

type CategoryRelation = KnowledgeCategory | KnowledgeCategory[] | null;

type RawArticle = Omit<
  KnowledgeArticle,
  "category" | "content" | "images" | "tips" | "warnings" | "model_generations"
> & {
  content: unknown;
  images: unknown;
  tips: unknown;
  warnings: unknown;
  model_generations?: unknown;
  knowledge_categories?: CategoryRelation;
};

type RawFAQ = Omit<FAQItem, "category" | "model_generations"> & {
  model_generations?: unknown;
  knowledge_categories?: CategoryRelation;
};

type RawAccessory = Omit<
  AccessoryItem,
  "category" | "what_to_check" | "risk_notes" | "external_links" | "model_generations"
> & {
  what_to_check: unknown;
  risk_notes: unknown;
  external_links: unknown;
  model_generations?: unknown;
  knowledge_categories?: CategoryRelation;
};

type RawSparePart = Omit<
  SparePartItem,
  "category" | "external_links" | "images" | "model_generations"
> & {
  external_links: unknown;
  images: unknown;
  model_generations?: unknown;
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
  if (await isDevAuthBypassRequest()) return true;

  const user = await getCurrentUser();
  if (!user) return false;

  if (process.env.NODE_ENV !== "production" && process.env.DEV_ADMIN_EMAIL) {
    const emails = process.env.DEV_ADMIN_EMAIL.split(",").map((e) => e.trim().toLowerCase());
    if (user.email && emails.includes(user.email.toLowerCase())) return true;
  }

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
  if (await isDevAuthBypassRequest()) {
    return { ok: true as const, user: null };
  }

  const user = await getCurrentUser();
  if (!user) return { ok: false as const, reason: "unauthenticated" as const };

  const admin = await isCurrentUserAdmin();
  if (!admin) return { ok: false as const, reason: "forbidden" as const };

  return { ok: true as const, user };
}

async function isDevAuthBypassRequest() {
  if (process.env.NODE_ENV === "production") return false;

  const headersList = await headers();
  return headersList.get("x-voltflow-dev-auth-bypass") === "1";
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
  await upsertArticleKnowledgeItem(data.id as string, input);
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
  await upsertArticleKnowledgeItem(id, input);
}

export async function updateArticleStatus(id: string, status: ArticleStatus) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("knowledge_articles")
    .update({
      status,
      published_at: status === "published" ? new Date().toISOString() : null,
    })
    .eq("id", id);

  if (error) throw error;

  const { error: knowledgeError } = await supabaseAdmin
    .from("knowledge_items")
    .update({ is_published: status === "published" })
    .eq("id", id);

  if (knowledgeError) throw knowledgeError;
  invalidateKnowledgeSearchCache();
}

export async function deleteArticle(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("knowledge_articles").delete().eq("id", id);
  if (error) throw error;
  await deleteKnowledgeItem(id);
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
  await upsertFAQKnowledgeItem(data.id as string, input);
  return data.id as string;
}

export async function updateFAQ(id: string, input: FAQInput) {
  const supabase = await createClient();
  const { error } = await supabase.from("faq_items").update(input).eq("id", id);
  if (error) throw error;
  await upsertFAQKnowledgeItem(id, input);
}

export async function deleteFAQ(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("faq_items").delete().eq("id", id);
  if (error) throw error;
  await deleteKnowledgeItem(id);
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
  await upsertAccessoryKnowledgeItem(data.id as string, input);
  return data.id as string;
}

export async function updateAccessory(id: string, input: AccessoryInput) {
  const supabase = await createClient();
  const { error } = await supabase.from("accessories").update(input).eq("id", id);
  if (error) throw error;
  await upsertAccessoryKnowledgeItem(id, input);
}

export async function deleteAccessory(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("accessories").delete().eq("id", id);
  if (error) throw error;
  await deleteKnowledgeItem(id);
}

export async function getPublishedSpareParts() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("spare_parts")
    .select("*, knowledge_categories(*)")
    .eq("status", "published")
    .order("sort_order", { ascending: true })
    .order("title", { ascending: true });

  if (error) throw error;
  return (data ?? []).map((item) => mapSparePart(item as RawSparePart));
}

export async function getAdminSpareParts() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("spare_parts")
    .select("*, knowledge_categories(*)")
    .order("sort_order", { ascending: true })
    .order("updated_at", { ascending: false });

  if (error) throw error;
  return (data ?? []).map((item) => mapSparePart(item as RawSparePart));
}

export async function getAdminSparePart(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("spare_parts")
    .select("*, knowledge_categories(*)")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data ? mapSparePart(data as RawSparePart) : null;
}

export async function createSparePart(input: SparePartInput) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("spare_parts")
    .insert(input)
    .select("id")
    .single();

  if (error) throw error;
  await upsertSparePartKnowledgeItem(data.id as string, input);
  return data.id as string;
}

export async function updateSparePart(id: string, input: SparePartInput) {
  const supabase = await createClient();
  const { error } = await supabase.from("spare_parts").update(input).eq("id", id);
  if (error) throw error;
  await upsertSparePartKnowledgeItem(id, input);
}

export async function deleteSparePart(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("spare_parts").delete().eq("id", id);
  if (error) throw error;
  await deleteKnowledgeItem(id);
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
    const [categories, articles, faq, accessories, spareParts] = await Promise.all([
      getCategories(),
      getPublishedArticles(),
      getPublishedFAQ(),
      getPublishedAccessories(),
      getPublishedSpareParts(),
    ]);

    if (!articles.length && !faq.length && !accessories.length && !spareParts.length) {
      return fallback;
    }

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
      spareParts: spareParts.length ? spareParts : fallback.spareParts,
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
    images: input.images,
    tips: input.tips,
    warnings: input.warnings,
    tags: input.tags,
    model_generations: input.model_generations,
    status: input.status,
    source_label: input.source_label,
    sort_order: input.sort_order,
    published_at: input.status === "published" ? new Date().toISOString() : null,
  };
}

async function upsertArticleKnowledgeItem(id: string, input: ArticleInput) {
  const category = await getCategorySlug(input.category_id);
  const content = [
    input.summary,
    ...input.content.map((section) => `${section.heading}\n${section.body}`),
    ...input.content.flatMap((section) =>
      (section.images ?? []).map((image) => image.alt).filter(Boolean),
    ),
    ...input.tips.map((tip) => `Совет: ${tip}`),
    ...input.warnings.map((warning) => `Важно: ${warning}`),
  ]
    .filter(Boolean)
    .join("\n\n");

  await upsertKnowledgeItem({
    id,
    title: input.title,
    content,
    category,
    source_type: "article",
    source_url: `/telegram/article/${input.slug}`,
    source_slug: input.slug,
    tags: input.tags,
    model_generations: input.model_generations,
    is_published: input.status === "published",
  });
}

async function upsertFAQKnowledgeItem(id: string, input: FAQInput) {
  const category = await getCategorySlug(input.category_id);
  await upsertKnowledgeItem({
    id,
    title: input.question,
    content: input.answer,
    category,
    source_type: "faq",
    source_url: "/telegram?tab=faq",
    tags: input.tags,
    model_generations: input.model_generations,
    is_published: input.status === "published",
  });
}

async function upsertAccessoryKnowledgeItem(id: string, input: AccessoryInput) {
  const category = await getCategorySlug(input.category_id);
  const content = [
    input.use_case,
    input.why_useful,
    ...input.what_to_check.map((item) => `Проверить: ${item}`),
    ...input.risk_notes.map((item) => `Риск: ${item}`),
  ]
    .filter(Boolean)
    .join("\n\n");

  await upsertKnowledgeItem({
    id,
    title: input.title,
    content,
    category,
    source_type: "accessory",
    source_url: input.external_url,
    tags: input.search_keywords,
    model_generations: input.model_generations,
    is_published: input.status === "published",
  });
}

async function upsertSparePartKnowledgeItem(id: string, input: SparePartInput) {
  const category = await getCategorySlug(input.category_id);
  const content = [input.description, input.part_number, input.compatibility]
    .filter(Boolean)
    .join("\n\n");

  await upsertKnowledgeItem({
    id,
    title: input.title,
    content,
    category,
    source_type: "spare_part",
    tags: input.search_keywords,
    model_generations: input.model_generations,
    is_published: input.status === "published",
  });
}

async function upsertKnowledgeItem(item: {
  id: string;
  title: string;
  content: string;
  category: string;
  source_type: string;
  source_url?: string | null;
  source_slug?: string | null;
  tags: string[];
  model_generations: CarGeneration[];
  is_published: boolean;
}) {
  const embeddingText = buildKnowledgeEmbeddingText({
    title: item.title,
    content: item.content,
    category: item.category,
    tags: item.tags,
  });
  const embedding = await createEmbedding(embeddingText);
  const { error } = await supabaseAdmin.from("knowledge_items").upsert({
    id: item.id,
    title: item.title,
    content: item.content,
    category: item.category,
    source_type: item.source_type,
    source_url: item.source_url ?? null,
    telegram_message_id: null,
    source_id: item.id,
    source_slug: item.source_slug ?? null,
    model_generations: item.model_generations,
    tags: item.tags,
    embedding,
    is_published: item.is_published,
  });

  if (error) throw error;
  invalidateKnowledgeSearchCache();
}

async function deleteKnowledgeItem(id: string) {
  const { error } = await supabaseAdmin.from("knowledge_items").delete().eq("id", id);
  if (error) throw error;
  invalidateKnowledgeSearchCache();
}

async function getCategorySlug(categoryId: string | null) {
  if (!categoryId) return "faq";

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("knowledge_categories")
    .select("slug")
    .eq("id", categoryId)
    .maybeSingle();

  if (error) throw error;
  return data?.slug ?? "faq";
}

function mapArticle(row: RawArticle): KnowledgeArticle {
  return {
    ...row,
    category: firstRelation(row.knowledge_categories),
    content: parseSections(row.content),
    images: parseImages(row.images),
    tips: parseStringArray(row.tips),
    warnings: parseStringArray(row.warnings),
    tags: row.tags ?? [],
    model_generations: parseModelGenerations(row.model_generations),
  };
}

function mapFAQ(row: RawFAQ): FAQItem {
  return {
    ...row,
    category: firstRelation(row.knowledge_categories),
    tags: row.tags ?? [],
    model_generations: parseModelGenerations(row.model_generations),
  };
}

function mapAccessory(row: RawAccessory): AccessoryItem {
  return {
    ...row,
    category: firstRelation(row.knowledge_categories),
    what_to_check: parseStringArray(row.what_to_check),
    risk_notes: parseStringArray(row.risk_notes),
    search_keywords: row.search_keywords ?? [],
    model_generations: parseModelGenerations(row.model_generations),
    external_links: parseExternalLinks(row.external_links),
  };
}

function mapSparePart(row: RawSparePart): SparePartItem {
  return {
    ...row,
    category: firstRelation(row.knowledge_categories),
    external_links: parseExternalLinks(row.external_links),
    images: parseImages(row.images),
    search_keywords: row.search_keywords ?? [],
    model_generations: parseModelGenerations(row.model_generations),
  };
}

function firstRelation(relation: CategoryRelation | undefined) {
  return Array.isArray(relation) ? relation[0] ?? null : relation;
}

function parseSections(value: unknown): KnowledgeArticleSection[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const section = item as Record<string, unknown>;
    const parsedSection = {
      heading: String(section.heading ?? ""),
      body: String(section.body ?? ""),
      images: parseImages(section.images),
    };

    return parsedSection.heading.trim() || parsedSection.body.trim() || parsedSection.images.length
      ? [parsedSection]
      : [];
  });
}

function parseStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item)).filter(Boolean);
}

function parseExternalLinks(value: unknown): AccessoryExternalLink[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const link = item as Record<string, unknown>;
      const url = String(link.url ?? "").trim();
      if (!url) return null;

      return {
        label: String(link.label ?? "").trim() || "Ссылка на товар",
        url,
      };
    })
    .filter((item): item is AccessoryExternalLink => Boolean(item));
}

function parseImages(value: unknown): SparePartImage[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const image = item as Record<string, unknown>;
      const url = String(image.url ?? "").trim();
      if (!url) return null;

      return {
        url,
        alt: String(image.alt ?? "").trim(),
      };
    })
    .filter((item): item is SparePartImage => Boolean(item));
}

function parseModelGenerations(value: unknown) {
  if (!Array.isArray(value)) return normalizeModelGenerations(undefined);
  return normalizeModelGenerations(value.filter(isCarGeneration));
}

export function toTelegramArticle(article: KnowledgeArticle): TelegramKnowledgeArticle {
  return {
    id: article.id,
    slug: article.slug,
    title: article.title,
    category: article.category?.title ?? "Knowledge",
    categorySlug: article.category?.slug ?? "knowledge",
    modelGenerations: article.model_generations,
    tags: article.tags,
    summary: article.summary ?? "",
    sections: article.content,
    images: article.images,
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
    modelGenerations: item.model_generations,
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
    modelGenerations: item.model_generations,
    externalUrl: item.external_url ?? undefined,
    externalLinks: item.external_links.length
      ? item.external_links
      : item.external_url
        ? [{ label: "Ссылка на товар", url: item.external_url }]
        : undefined,
    imageUrl: item.image_url ?? undefined,
    imageAlt: item.image_alt ?? undefined,
  };
}
