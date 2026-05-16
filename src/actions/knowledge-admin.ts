"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  createAccessory,
  createArticle,
  createCategory,
  createFAQ,
  deleteAccessory,
  deleteArticle,
  deleteCategory,
  deleteFAQ,
  requireAdmin,
  updateAccessory,
  updateArticle,
  updateCategory,
  updateFAQ,
} from "@/lib/supabase/knowledge";
import { createClient } from "@/lib/supabase/server";
import type {
  AccessoryInput,
  AccessoryPriority,
  ArticleInput,
  ArticleStatus,
  CategoryInput,
  FAQInput,
  KnowledgeArticleSection,
} from "@/types/knowledge";

export type AdminFormState = {
  ok?: boolean;
  message?: string;
  errors?: Record<string, string>;
};

const statuses = ["draft", "published", "archived"] as const;
const priorities = ["must-have", "useful", "optional"] as const;

export async function createArticleAction(
  _state: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const guard = await requireAdmin();
  if (!guard.ok) return { message: "You do not have admin access." };

  const input = await parseArticleForm(formData);
  if (isFormState(input)) return input;

  await createArticle(input);
  revalidateKnowledge();
  redirect("/admin/knowledge/articles");
}

export async function updateArticleAction(
  id: string,
  _state: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const guard = await requireAdmin();
  if (!guard.ok) return { message: "You do not have admin access." };

  const input = await parseArticleForm(formData, id);
  if (isFormState(input)) return input;

  await updateArticle(id, input);
  revalidateKnowledge();
  redirect("/admin/knowledge/articles");
}

export async function deleteArticleAction(formData: FormData) {
  const guard = await requireAdmin();
  if (!guard.ok) redirect("/admin/knowledge");

  await deleteArticle(stringValue(formData, "id"));
  revalidateKnowledge();
}

export async function createFAQAction(
  _state: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const guard = await requireAdmin();
  if (!guard.ok) return { message: "You do not have admin access." };

  const input = parseFAQForm(formData);
  if (isFormState(input)) return input;

  await createFAQ(input);
  revalidateKnowledge();
  redirect("/admin/knowledge/faq");
}

export async function updateFAQAction(
  id: string,
  _state: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const guard = await requireAdmin();
  if (!guard.ok) return { message: "You do not have admin access." };

  const input = parseFAQForm(formData);
  if (isFormState(input)) return input;

  await updateFAQ(id, input);
  revalidateKnowledge();
  redirect("/admin/knowledge/faq");
}

export async function deleteFAQAction(formData: FormData) {
  const guard = await requireAdmin();
  if (!guard.ok) redirect("/admin/knowledge");

  await deleteFAQ(stringValue(formData, "id"));
  revalidateKnowledge();
}

export async function createAccessoryAction(
  _state: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const guard = await requireAdmin();
  if (!guard.ok) return { message: "You do not have admin access." };

  const input = parseAccessoryForm(formData);
  if (isFormState(input)) return input;

  await createAccessory(input);
  revalidateKnowledge();
  redirect("/admin/knowledge/accessories");
}

export async function updateAccessoryAction(
  id: string,
  _state: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const guard = await requireAdmin();
  if (!guard.ok) return { message: "You do not have admin access." };

  const input = parseAccessoryForm(formData);
  if (isFormState(input)) return input;

  await updateAccessory(id, input);
  revalidateKnowledge();
  redirect("/admin/knowledge/accessories");
}

export async function deleteAccessoryAction(formData: FormData) {
  const guard = await requireAdmin();
  if (!guard.ok) redirect("/admin/knowledge");

  await deleteAccessory(stringValue(formData, "id"));
  revalidateKnowledge();
}

export async function upsertCategoryAction(
  _state: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const guard = await requireAdmin();
  if (!guard.ok) return { message: "You do not have admin access." };

  const id = stringValue(formData, "id");
  const input = await parseCategoryForm(formData, id || undefined);
  if (isFormState(input)) return input;

  if (id) {
    await updateCategory(id, input);
  } else {
    await createCategory(input);
  }
  revalidateKnowledge();
  return { ok: true, message: id ? "Category updated." : "Category created." };
}

export async function deleteCategoryAction(formData: FormData) {
  const guard = await requireAdmin();
  if (!guard.ok) redirect("/admin/knowledge");

  await deleteCategory(stringValue(formData, "id"));
  revalidateKnowledge();
}

async function parseArticleForm(
  formData: FormData,
  currentId?: string,
): Promise<ArticleInput | AdminFormState> {
  const input: ArticleInput = {
    title: stringValue(formData, "title"),
    slug: slugify(stringValue(formData, "slug")),
    summary: nullableString(formData, "summary"),
    category_id: stringValue(formData, "category_id"),
    tags: listValue(formData, "tags"),
    content: sectionValue(formData, "content"),
    tips: multilineValue(formData, "tips"),
    warnings: multilineValue(formData, "warnings"),
    source_label: nullableString(formData, "source_label"),
    status: statusValue(formData),
    sort_order: numberValue(formData, "sort_order"),
    related_article_ids: formData.getAll("related_article_ids").map(String),
  };

  const errors = await validateArticle(input, currentId);
  return Object.keys(errors).length ? { errors } : input;
}

function parseFAQForm(formData: FormData): FAQInput | AdminFormState {
  const input: FAQInput = {
    question: stringValue(formData, "question"),
    answer: stringValue(formData, "answer"),
    category_id: stringValue(formData, "category_id"),
    tags: listValue(formData, "tags"),
    status: statusValue(formData),
    sort_order: numberValue(formData, "sort_order"),
  };

  const errors: Record<string, string> = {};
  if (!input.question) errors.question = "Question is required.";
  if (!input.answer) errors.answer = "Answer is required.";
  if (!input.category_id) errors.category_id = "Category is required.";
  if (!statuses.includes(input.status)) errors.status = "Choose a valid status.";
  return Object.keys(errors).length ? { errors } : input;
}

function parseAccessoryForm(formData: FormData): AccessoryInput | AdminFormState {
  const input: AccessoryInput = {
    title: stringValue(formData, "title"),
    category_id: stringValue(formData, "category_id"),
    use_case: nullableString(formData, "use_case"),
    why_useful: nullableString(formData, "why_useful"),
    what_to_check: multilineValue(formData, "what_to_check"),
    priority: priorityValue(formData),
    risk_notes: multilineValue(formData, "risk_notes"),
    search_keywords: listValue(formData, "search_keywords"),
    external_url: nullableString(formData, "external_url"),
    status: statusValue(formData),
    sort_order: numberValue(formData, "sort_order"),
  };

  const errors: Record<string, string> = {};
  if (!input.title) errors.title = "Title is required.";
  if (!input.category_id) errors.category_id = "Category is required.";
  if (!statuses.includes(input.status)) errors.status = "Choose a valid status.";
  if (!priorities.includes(input.priority)) errors.priority = "Choose a valid priority.";
  return Object.keys(errors).length ? { errors } : input;
}

async function parseCategoryForm(
  formData: FormData,
  currentId?: string,
): Promise<CategoryInput | AdminFormState> {
  const input: CategoryInput = {
    title: stringValue(formData, "title"),
    slug: slugify(stringValue(formData, "slug")),
    description: nullableString(formData, "description"),
    sort_order: numberValue(formData, "sort_order"),
  };

  const errors: Record<string, string> = {};
  if (!input.title) errors.title = "Title is required.";
  if (!input.slug) errors.slug = "Slug is required.";
  if (input.slug && (await isSlugTaken("knowledge_categories", input.slug, currentId))) {
    errors.slug = "Slug is already used.";
  }
  return Object.keys(errors).length ? { errors } : input;
}

async function validateArticle(input: ArticleInput, currentId?: string) {
  const errors: Record<string, string> = {};
  if (!input.title) errors.title = "Title is required.";
  if (!input.slug) errors.slug = "Slug is required.";
  if (!input.category_id) errors.category_id = "Category is required.";
  if (!statuses.includes(input.status)) errors.status = "Choose a valid status.";
  if (!input.content.length) errors.content = "Add at least one content section.";
  if (input.slug && (await isSlugTaken("knowledge_articles", input.slug, currentId))) {
    errors.slug = "Slug is already used.";
  }
  return errors;
}

async function isSlugTaken(
  table: "knowledge_articles" | "knowledge_categories",
  slug: string,
  currentId?: string,
) {
  const supabase = await createClient();
  let query = supabase.from(table).select("id").eq("slug", slug).limit(1);
  if (currentId) query = query.neq("id", currentId);
  const { data } = await query;
  return Boolean(data?.length);
}

function stringValue(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function nullableString(formData: FormData, name: string) {
  const value = stringValue(formData, name);
  return value || null;
}

function numberValue(formData: FormData, name: string) {
  const parsed = Number.parseInt(stringValue(formData, name), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function listValue(formData: FormData, name: string) {
  return stringValue(formData, name)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function multilineValue(formData: FormData, name: string) {
  return stringValue(formData, name)
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function sectionValue(formData: FormData, prefix: string): KnowledgeArticleSection[] {
  const headings = formData.getAll(`${prefix}_heading`).map(String);
  const bodies = formData.getAll(`${prefix}_body`).map(String);

  return headings
    .map((heading, index) => ({
      heading: heading.trim(),
      body: (bodies[index] ?? "").trim(),
    }))
    .filter((section) => section.heading || section.body);
}

function statusValue(formData: FormData): ArticleStatus {
  const value = stringValue(formData, "status");
  return statuses.includes(value as ArticleStatus) ? (value as ArticleStatus) : "draft";
}

function priorityValue(formData: FormData): AccessoryPriority {
  const value = stringValue(formData, "priority");
  return priorities.includes(value as AccessoryPriority)
    ? (value as AccessoryPriority)
    : "useful";
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function revalidateKnowledge() {
  revalidatePath("/admin/knowledge");
  revalidatePath("/telegram");
  revalidatePath("/telegram/article/[slug]", "page");
  revalidatePath("/telegram/category/[slug]", "page");
}

function isFormState<T>(value: T | AdminFormState): value is AdminFormState {
  return typeof value === "object" && value !== null && ("errors" in value || "message" in value || "ok" in value);
}
