"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { isCarGeneration } from "@/lib/car-generations";

import {
  createAccessory,
  createArticle,
  createCategory,
  createFAQ,
  createSparePart,
  createServiceProvider,
  deleteAccessory,
  deleteArticle,
  deleteCategory,
  deleteFAQ,
  deleteSparePart,
  deleteServiceProvider,
  requireAdmin,
  updateAccessory,
  updateArticle,
  updateArticleStatus,
  updateCategory,
  updateFAQ,
  updateSparePart,
  updateServiceProvider,
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
  SparePartImage,
  SparePartInput,
  ServiceProviderInput,
} from "@/types/knowledge";

export type AdminFormState = {
  ok?: boolean;
  message?: string;
  errors?: Record<string, string>;
  values?: Record<string, string | string[]>;
};

const statuses = ["draft", "published", "archived"] as const;
const priorities = ["must-have", "useful", "optional"] as const;

export async function createArticleAction(
  _state: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const guard = await requireAdmin();
  if (!guard.ok) return { message: "Нет доступа администратора." };

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
  if (!guard.ok) return { message: "Нет доступа администратора." };

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

export async function updateArticleStatusAction(id: string, formData: FormData) {
  const guard = await requireAdmin();
  if (!guard.ok) redirect("/admin/knowledge");

  await updateArticleStatus(id, statusValue(formData));
  revalidateKnowledge();
  revalidatePath(`/admin/knowledge/articles/${id}/preview`);
  redirect(`/admin/knowledge/articles/${id}/preview`);
}

export async function createFAQAction(
  _state: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const guard = await requireAdmin();
  if (!guard.ok) return { message: "Нет доступа администратора." };

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
  if (!guard.ok) return { message: "Нет доступа администратора." };

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
  if (!guard.ok) return { message: "Нет доступа администратора." };

  const input = await parseAccessoryForm(formData);
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
  if (!guard.ok) return { message: "Нет доступа администратора." };

  const input = await parseAccessoryForm(formData);
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

export async function createSparePartAction(
  _state: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const guard = await requireAdmin();
  if (!guard.ok) return { message: "Нет доступа администратора." };

  const input = await parseSparePartForm(formData);
  if (isFormState(input)) return input;

  await createSparePart(input);
  revalidateKnowledge();
  redirect("/admin/knowledge/spare-parts");
}

export async function updateSparePartAction(
  id: string,
  _state: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const guard = await requireAdmin();
  if (!guard.ok) return { message: "Нет доступа администратора." };

  const input = await parseSparePartForm(formData);
  if (isFormState(input)) return input;

  await updateSparePart(id, input);
  revalidateKnowledge();
  redirect("/admin/knowledge/spare-parts");
}

export async function deleteSparePartAction(formData: FormData) {
  const guard = await requireAdmin();
  if (!guard.ok) redirect("/admin/knowledge");

  await deleteSparePart(stringValue(formData, "id"));
  revalidateKnowledge();
}

export async function createServiceProviderAction(
  _state: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const guard = await requireAdmin();
  if (!guard.ok) return { message: "Нет доступа администратора." };

  const input = parseServiceProviderForm(formData);
  if (isFormState(input)) return input;

  await createServiceProvider(input);
  revalidateKnowledge();
  redirect("/admin/knowledge/service-providers");
}

export async function updateServiceProviderAction(
  id: string,
  _state: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const guard = await requireAdmin();
  if (!guard.ok) return { message: "Нет доступа администратора." };

  const input = parseServiceProviderForm(formData);
  if (isFormState(input)) return input;

  await updateServiceProvider(id, input);
  revalidateKnowledge();
  redirect("/admin/knowledge/service-providers");
}

export async function deleteServiceProviderAction(formData: FormData) {
  const guard = await requireAdmin();
  if (!guard.ok) redirect("/admin/knowledge");

  await deleteServiceProvider(stringValue(formData, "id"));
  revalidateKnowledge();
}

export async function upsertCategoryAction(
  _state: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const guard = await requireAdmin();
  if (!guard.ok) return { message: "Нет доступа администратора." };

  const id = stringValue(formData, "id");
  const input = await parseCategoryForm(formData, id || undefined);
  if (isFormState(input)) return input;

  if (id) {
    await updateCategory(id, input);
  } else {
    await createCategory(input);
  }
  revalidateKnowledge();
  return { ok: true, message: id ? "Раздел обновлен." : "Раздел создан." };
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
    model_generations: formData
      .getAll("model_generations")
      .map(String)
      .filter(isCarGeneration),
    tags: listValue(formData, "tags"),
    content: sectionValue(formData, "content"),
    images: existingImagesValue(formData),
    tips: multilineValue(formData, "tips"),
    warnings: multilineValue(formData, "warnings"),
    source_label: nullableString(formData, "source_label"),
    status: statusValue(formData),
    sort_order: numberValue(formData, "sort_order"),
    related_article_ids: formData.getAll("related_article_ids").map(String),
  };

  const uploadedImages = await uploadArticleImages(formData.getAll("image_files"));
  input.images = [...input.images, ...uploadedImages];
  input.content = await uploadArticleSectionImages(formData, input.content);

  const errors = await validateArticle(input, currentId);
  return Object.keys(errors).length ? { errors, values: formValues(formData) } : input;
}

function parseFAQForm(formData: FormData): FAQInput | AdminFormState {
  const input: FAQInput = {
    question: stringValue(formData, "question"),
    answer: stringValue(formData, "answer"),
    category_id: stringValue(formData, "category_id"),
    tags: listValue(formData, "tags"),
    model_generations: formData
      .getAll("model_generations")
      .map(String)
      .filter(isCarGeneration),
    status: statusValue(formData),
    sort_order: numberValue(formData, "sort_order"),
  };

  const errors: Record<string, string> = {};
  if (!input.question) errors.question = "Вопрос обязателен.";
  if (!input.answer) errors.answer = "Ответ обязателен.";
  if (!input.category_id) errors.category_id = "Раздел обязателен.";
  if (!input.model_generations.length) {
    errors.model_generations = "Выберите хотя бы одно поколение.";
  }
  if (!statuses.includes(input.status)) errors.status = "Выберите корректный статус.";
  return Object.keys(errors).length ? { errors, values: formValues(formData) } : input;
}

async function parseAccessoryForm(formData: FormData): Promise<AccessoryInput | AdminFormState> {
  const input: AccessoryInput = {
    title: stringValue(formData, "title"),
    category_id: stringValue(formData, "category_id"),
    use_case: nullableString(formData, "use_case"),
    why_useful: nullableString(formData, "why_useful"),
    what_to_check: multilineValue(formData, "what_to_check"),
    priority: priorityValue(formData),
    risk_notes: multilineValue(formData, "risk_notes"),
    search_keywords: listValue(formData, "search_keywords"),
    model_generations: formData
      .getAll("model_generations")
      .map(String)
      .filter(isCarGeneration),
    external_url: nullableString(formData, "external_url"),
    external_links: externalLinksValue(formData),
    image_url: nullableString(formData, "image_url"),
    image_alt: nullableString(formData, "image_alt"),
    status: statusValue(formData),
    sort_order: numberValue(formData, "sort_order"),
  };

  const image = formData.get("image_file");
  if (image instanceof File && image.size > 0) {
    input.image_url = await uploadAccessoryImage(image);
  }

  const errors: Record<string, string> = {};
  if (!input.title) errors.title = "Название обязательно.";
  if (!input.category_id) errors.category_id = "Раздел обязателен.";
  if (!input.model_generations.length) {
    errors.model_generations = "Выберите хотя бы одно поколение.";
  }
  if (!statuses.includes(input.status)) errors.status = "Выберите корректный статус.";
  if (!priorities.includes(input.priority)) errors.priority = "Выберите корректный приоритет.";
  return Object.keys(errors).length ? { errors, values: formValues(formData) } : input;
}

async function parseSparePartForm(formData: FormData): Promise<SparePartInput | AdminFormState> {
  const input: SparePartInput = {
    title: stringValue(formData, "title"),
    description: nullableString(formData, "description"),
    category_id: stringValue(formData, "category_id"),
    part_number: nullableString(formData, "part_number"),
    compatibility: nullableString(formData, "compatibility"),
    external_links: externalLinksValue(formData),
    images: existingImagesValue(formData),
    search_keywords: listValue(formData, "search_keywords"),
    model_generations: formData
      .getAll("model_generations")
      .map(String)
      .filter(isCarGeneration),
    status: statusValue(formData),
    sort_order: numberValue(formData, "sort_order"),
  };

  const uploadedImages = await uploadSparePartImages(formData.getAll("image_files"));
  input.images = [...input.images, ...uploadedImages];

  const errors: Record<string, string> = {};
  if (!input.title) errors.title = "Название обязательно.";
  if (!input.category_id) errors.category_id = "Раздел обязателен.";
  if (!input.description) errors.description = "Описание обязательно.";
  if (!input.model_generations.length) {
    errors.model_generations = "Выберите хотя бы одно поколение.";
  }
  if (!statuses.includes(input.status)) errors.status = "Выберите корректный статус.";
  return Object.keys(errors).length ? { errors, values: formValues(formData) } : input;
}

function parseServiceProviderForm(formData: FormData): ServiceProviderInput | AdminFormState {
  const input: ServiceProviderInput = {
    name: stringValue(formData, "name"),
    provider_type: providerTypeValue(formData),
    city: nullableString(formData, "city"),
    service_area: nullableString(formData, "service_area"),
    description: nullableString(formData, "description"),
    services: multilineValue(formData, "services"),
    price_from: nullableNumberValue(formData, "price_from"),
    currency: stringValue(formData, "currency") || "BYN",
    external_links: externalLinksValue(formData),
    model_generations: formData.getAll("model_generations").map(String).filter(isCarGeneration),
    image_url: nullableString(formData, "image_url"),
    image_alt: nullableString(formData, "image_alt"),
    status: statusValue(formData),
    sort_order: numberValue(formData, "sort_order"),
    verified_at: nullableString(formData, "verified_at"),
  };

  const errors: Record<string, string> = {};
  if (!input.name) errors.name = "Название обязательно.";
  if (!input.services.length) errors.services = "Добавьте хотя бы одну услугу.";
  if (!input.model_generations.length) errors.model_generations = "Выберите хотя бы одно поколение.";
  if (!statuses.includes(input.status)) errors.status = "Выберите корректный статус.";
  return Object.keys(errors).length ? { errors, values: formValues(formData) } : input;
}

async function uploadAccessoryImage(file: File) {
  const supabase = await createClient();
  const extension = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage
    .from("knowledge-accessories")
    .upload(path, file, {
      contentType: file.type || "image/jpeg",
      upsert: false,
    });

  if (error) throw error;

  const { data } = supabase.storage
    .from("knowledge-accessories")
    .getPublicUrl(path);

  return data.publicUrl;
}

async function uploadSparePartImages(files: FormDataEntryValue[]): Promise<SparePartImage[]> {
  return uploadImageList(files, "knowledge-spare-parts");
}

async function uploadArticleImages(files: FormDataEntryValue[]): Promise<SparePartImage[]> {
  return uploadImageList(files, "knowledge-articles");
}

async function uploadArticleSectionImages(
  formData: FormData,
  sections: KnowledgeArticleSection[],
): Promise<KnowledgeArticleSection[]> {
  const nextSections = sections.map((section) => ({
    ...section,
    images: [...(section.images ?? [])],
  }));

  for (const [index, section] of nextSections.entries()) {
    const uploadedImages = await uploadArticleImages(formData.getAll(`content_image_files_${index}`));
    if (uploadedImages.length) {
      section.images = [...(section.images ?? []), ...uploadedImages];
    }
  }

  return nextSections.map((section) =>
    section.images?.length ? section : { heading: section.heading, body: section.body },
  );
}

async function uploadImageList(files: FormDataEntryValue[], bucket: string): Promise<SparePartImage[]> {
  const uploads = files.filter((file): file is File => file instanceof File && file.size > 0);
  const images: SparePartImage[] = [];

  for (const file of uploads) {
    images.push({
      url: await uploadKnowledgeImage(file, bucket),
      alt: file.name.replace(/\.[^.]+$/, ""),
    });
  }

  return images;
}

async function uploadKnowledgeImage(file: File, bucket: string) {
  const supabase = await createClient();
  const extension = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, file, {
      contentType: file.type || "image/jpeg",
      upsert: false,
    });

  if (error) throw error;

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
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
  if (!input.title) errors.title = "Название обязательно.";
  if (!input.slug) errors.slug = "Slug обязателен.";
  if (input.slug && (await isSlugTaken("knowledge_categories", input.slug, currentId))) {
    errors.slug = "Этот slug уже используется.";
  }
  return Object.keys(errors).length ? { errors, values: formValues(formData) } : input;
}

async function validateArticle(input: ArticleInput, currentId?: string) {
  const errors: Record<string, string> = {};
  if (!input.title) errors.title = "Название обязательно.";
  if (!input.slug) errors.slug = "Slug обязателен.";
  if (!input.category_id) errors.category_id = "Раздел обязателен.";
  if (!statuses.includes(input.status)) errors.status = "Выберите корректный статус.";
  if (!input.content.length) errors.content = "Добавьте хотя бы один блок контента.";
  if (!input.model_generations.length) {
    errors.model_generations = "Выберите хотя бы одно поколение.";
  }
  if (input.slug && (await isSlugTaken("knowledge_articles", input.slug, currentId))) {
    errors.slug = "Этот slug уже используется.";
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

function formValues(formData: FormData) {
  const values: Record<string, string | string[]> = {};

  for (const key of new Set(formData.keys())) {
    const items = formData
      .getAll(key)
      .filter((item) => !(item instanceof File))
      .map(String);

    if (items.length === 0) continue;
    values[key] = items.length === 1 ? items[0] : items;
  }

  return values;
}

function nullableString(formData: FormData, name: string) {
  const value = stringValue(formData, name);
  return value || null;
}

function numberValue(formData: FormData, name: string) {
  const parsed = Number.parseInt(stringValue(formData, name), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumberValue(formData: FormData, name: string) {
  const value = stringValue(formData, name);
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
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

function externalLinksValue(formData: FormData) {
  const labels = formData.getAll("external_link_label").map(String);
  const urls = formData.getAll("external_link_url").map(String);

  return urls
    .map((url, index) => ({
      label: labels[index]?.trim() || "Ссылка на товар",
      url: url.trim(),
    }))
    .filter((link) => link.url);
}

function existingImagesValue(formData: FormData): SparePartImage[] {
  const urls = formData.getAll("existing_image_url").map(String);
  const alts = formData.getAll("existing_image_alt").map(String);

  return urls
    .map((url, index) => ({
      url: url.trim(),
      alt: alts[index]?.trim() || "",
    }))
    .filter((image) => image.url);
}

function sectionValue(formData: FormData, prefix: string): KnowledgeArticleSection[] {
  const headings = formData.getAll(`${prefix}_heading`).map(String);
  const bodies = formData.getAll(`${prefix}_body`).map(String);
  const sectionImages = existingSectionImagesValue(formData);

  return headings
    .map((heading, index) => ({
      heading: heading.trim(),
      body: (bodies[index] ?? "").trim(),
      images: sectionImages.get(index) ?? [],
    }))
    .filter((section) => section.heading || section.body || section.images.length)
    .map((section) =>
      section.images.length
        ? section
        : { heading: section.heading, body: section.body },
    );
}

function existingSectionImagesValue(formData: FormData) {
  const indexes = formData.getAll("content_image_section_index").map(String);
  const urls = formData.getAll("content_image_url").map(String);
  const alts = formData.getAll("content_image_alt").map(String);
  const imagesBySection = new Map<number, SparePartImage[]>();

  urls.forEach((url, index) => {
    const sectionIndex = Number.parseInt(indexes[index] ?? "", 10);
    const trimmedUrl = url.trim();
    if (!Number.isFinite(sectionIndex) || !trimmedUrl) return;

    const images = imagesBySection.get(sectionIndex) ?? [];
    images.push({
      url: trimmedUrl,
      alt: alts[index]?.trim() || "",
    });
    imagesBySection.set(sectionIndex, images);
  });

  return imagesBySection;
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

function providerTypeValue(formData: FormData): ServiceProviderInput["provider_type"] {
  const value = stringValue(formData, "provider_type");
  return ["service_center", "mobile_service", "detailer", "parts_and_service", "other"].includes(value)
    ? (value as ServiceProviderInput["provider_type"])
    : "service_center";
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
