"use client";

import Image from "next/image";
import Link from "next/link";
import { useActionState, useState, useTransition } from "react";

import type { AdminFormState } from "@/actions/knowledge-admin";
import { JsonSectionsEditor } from "@/components/admin/knowledge/JsonSectionsEditor";
import { TagsInput } from "@/components/admin/knowledge/TagsInput";
import { stateKey, stateList, stateString } from "@/components/admin/knowledge/form-state";
import { carGenerations } from "@/lib/car-generations";
import { telegramGenerationLabels } from "@/lib/telegram/generation";
import type { KnowledgeArticle, KnowledgeCategory } from "@/types/knowledge";

type ArticleFormProps = {
  article?: KnowledgeArticle;
  categories: KnowledgeCategory[];
  articles: KnowledgeArticle[];
  action: (state: AdminFormState, formData: FormData) => Promise<AdminFormState>;
};

export function ArticleForm({ article, categories, articles, action }: ArticleFormProps) {
  const [state, formAction, pending] = useActionState(action, {});
  const [isPreparing, setIsPreparing] = useState(false);
  const [isDispatching, startTransition] = useTransition();
  const [clientError, setClientError] = useState<string | null>(null);
  const [title, setTitle] = useState(stateString(state, "title", article?.title ?? ""));
  const [slug, setSlug] = useState(stateString(state, "slug", article?.slug ?? ""));
  const [slugTouched, setSlugTouched] = useState(Boolean(article?.slug));
  const isSaving = pending || isPreparing || isDispatching;
  const images = state.values
    ? stateList(state, "existing_image_url").map((url, index) => ({
        url,
        alt: stateList(state, "existing_image_alt")[index] ?? "",
      }))
    : article?.images ?? [];

  async function submitPreparedForm(formData: FormData) {
    setClientError(null);
    setIsPreparing(true);

    try {
      const preparedFormData = await compressArticleImages(formData);
      startTransition(() => {
        formAction(preparedFormData);
      });
    } catch {
      setClientError("Не удалось подготовить изображения. Попробуйте выбрать другие файлы или уменьшить их размер.");
    } finally {
      setIsPreparing(false);
    }
  }

  return (
    <form key={stateKey(state)} action={submitPreparedForm} className="grid gap-5 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-4">
        <Panel>
          <FieldError message={state.message} />
          <FieldError message={clientError ?? undefined} />
          <label className="space-y-1.5 text-sm font-semibold">
            <span>Название</span>
            <input
              name="title"
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                if (!slugTouched) setSlug(slugify(event.target.value));
              }}
              className={inputClass}
            />
            <FieldError message={state.errors?.title} />
          </label>
          <label className="space-y-1.5 text-sm font-semibold">
            <span>Slug</span>
            <input
              name="slug"
              value={slug}
              onChange={(event) => {
                setSlugTouched(true);
                setSlug(event.target.value);
              }}
              className={inputClass}
            />
            <FieldError message={state.errors?.slug} />
          </label>
          <label className="space-y-1.5 text-sm font-semibold">
            <span>Краткое описание</span>
            <textarea name="summary" defaultValue={stateString(state, "summary", article?.summary ?? "")} className={textareaClass} />
          </label>
          <JsonSectionsEditor
            defaultValue={
              state.values
                ? sectionsFromState(state)
                : article?.content
            }
            error={state.errors?.content}
          />
          <div className="space-y-3">
            <label className="space-y-1.5 text-sm font-semibold">
              <span>Фото статьи</span>
              <input
                name="image_files"
                type="file"
                accept="image/*"
                multiple
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-bold file:text-primary-foreground"
              />
              <span className="text-xs font-normal text-muted-foreground">
                Можно загрузить несколько фото. Первое фото будет обложкой карточки и первым слайдом галереи.
              </span>
            </label>
            {images.length ? (
              <div className="grid gap-3 md:grid-cols-3">
                {images.map((image, index) => (
                  <div key={`${image.url}-${index}`} className="rounded-lg border border-border bg-white/[0.03] p-2">
                    <Image
                      src={image.url}
                      alt={image.alt || article?.title || "Фото статьи"}
                      width={320}
                      height={180}
                      unoptimized
                      className="aspect-[16/9] w-full rounded-lg object-cover"
                    />
                    <input type="hidden" name="existing_image_url" value={image.url} />
                    <input
                      name="existing_image_alt"
                      defaultValue={image.alt}
                      className="mt-2 min-h-9 w-full rounded-lg border border-input bg-background px-2 text-xs outline-none"
                      placeholder="Описание фото"
                    />
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <label className="space-y-1.5 text-sm font-semibold">
            <span>Советы</span>
            <textarea name="tips" defaultValue={stateString(state, "tips", article?.tips.join("\n") ?? "")} className={textareaClass} />
            <span className="text-xs font-normal text-muted-foreground">Один совет на строку.</span>
          </label>
          <label className="space-y-1.5 text-sm font-semibold">
            <span>Предупреждения</span>
            <textarea name="warnings" defaultValue={stateString(state, "warnings", article?.warnings.join("\n") ?? "")} className={textareaClass} />
            <span className="text-xs font-normal text-muted-foreground">Одно предупреждение на строку.</span>
          </label>
        </Panel>
      </div>

      <aside className="space-y-4">
        <Panel>
          <label className="space-y-1.5 text-sm font-semibold">
            <span>Статус</span>
            <select name="status" defaultValue={stateString(state, "status", article?.status ?? "draft")} className={inputClass}>
              <option value="draft">Черновик</option>
              <option value="published">Опубликовано</option>
              <option value="archived">Архив</option>
            </select>
            <FieldError message={state.errors?.status} />
          </label>
          <fieldset className="space-y-2 text-sm font-semibold">
            <legend>Поколения Yuan Up</legend>
            <div className="space-y-2">
              {carGenerations.map((generation) => (
                <label key={generation} className="flex items-center gap-2 font-normal">
                  <input
                    type="checkbox"
                    name="model_generations"
                    value={generation}
                    defaultChecked={(article?.model_generations ?? carGenerations).includes(
                      generation,
                    )}
                    className="size-4 rounded border border-input"
                  />
                  <span>{telegramGenerationLabels[generation]}</span>
                </label>
              ))}
            </div>
            <FieldError message={state.errors?.model_generations} />
          </fieldset>
          <label className="space-y-1.5 text-sm font-semibold">
            <span>Раздел</span>
            <select name="category_id" defaultValue={stateString(state, "category_id", article?.category_id ?? "")} className={inputClass}>
              <option value="">Выберите раздел</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>{category.title}</option>
              ))}
            </select>
            <FieldError message={state.errors?.category_id} />
          </label>
          <TagsInput name="tags" label="Теги" defaultValue={stateString(state, "tags", article?.tags.join(", ") ?? "")} />
          <label className="space-y-1.5 text-sm font-semibold">
            <span>Источник</span>
            <input name="source_label" defaultValue={stateString(state, "source_label", article?.source_label ?? "")} className={inputClass} />
          </label>
          <label className="space-y-1.5 text-sm font-semibold">
            <span>Порядок сортировки</span>
            <input name="sort_order" type="number" defaultValue={stateString(state, "sort_order", String(article?.sort_order ?? 0))} className={inputClass} />
          </label>
          <label className="space-y-1.5 text-sm font-semibold">
            <span>Связанные статьи</span>
            <select
              name="related_article_ids"
              multiple
              defaultValue={stateList(state, "related_article_ids", article?.related_article_ids ?? [])}
              className="min-h-40 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
            >
              {articles
                .filter((item) => item.id !== article?.id)
                .map((item) => (
                  <option key={item.id} value={item.id}>{item.title}</option>
                ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-2 pt-2">
            <button disabled={isSaving} className="min-h-10 rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-60">
              {isPreparing ? "Подготовка фото..." : pending || isDispatching ? "Сохранение..." : "Сохранить"}
            </button>
            <Link href="/admin/knowledge/articles" className="inline-flex min-h-10 items-center rounded-lg border border-border px-4 text-sm font-semibold">
              Отмена
            </Link>
          </div>
        </Panel>
      </aside>
    </form>
  );
}

const imageFieldPattern = /^(image_files|content_image_files_\d+)$/;
const imageCompressionThreshold = 700 * 1024;
const maxImageDimension = 1600;
const compressedImageQuality = 0.82;

export const inputClass =
  "min-h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/40";
export const textareaClass =
  "min-h-28 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/40";

export function Panel({ children }: { children: React.ReactNode }) {
  return <section className="space-y-4 rounded-lg border border-border bg-card p-4">{children}</section>;
}

export function FieldError({ message }: { message?: string }) {
  return message ? <p className="text-xs font-semibold text-destructive">{message}</p> : null;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function sectionsFromState(state: AdminFormState) {
  const imageSectionIndexes = stateList(state, "content_image_section_index");
  const imageUrls = stateList(state, "content_image_url");
  const imageAlts = stateList(state, "content_image_alt");

  return stateList(state, "content_heading").map((heading, index) => ({
    heading,
    body: stateList(state, "content_body")[index] ?? "",
    images: imageUrls
      .map((url, imageIndex) => ({
        sectionIndex: Number.parseInt(imageSectionIndexes[imageIndex] ?? "", 10),
        url,
        alt: imageAlts[imageIndex] ?? "",
      }))
      .filter((image) => image.sectionIndex === index && image.url)
      .map(({ url, alt }) => ({ url, alt })),
  }));
}

async function compressArticleImages(formData: FormData) {
  const nextFormData = new FormData();

  for (const [name, value] of formData.entries()) {
    if (value instanceof File && shouldCompressArticleImage(name, value)) {
      nextFormData.append(name, await compressImageFile(value));
      continue;
    }

    nextFormData.append(name, value);
  }

  return nextFormData;
}

function shouldCompressArticleImage(name: string, file: File) {
  return (
    imageFieldPattern.test(name) &&
    file.size > imageCompressionThreshold &&
    file.type.startsWith("image/") &&
    file.type !== "image/gif" &&
    file.type !== "image/svg+xml"
  );
}

async function compressImageFile(file: File) {
  const image = await loadImage(file);
  const scale = Math.min(1, maxImageDimension / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) return file;

  canvas.width = width;
  canvas.height = height;
  context.drawImage(image, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", compressedImageQuality);
  });

  if (!blob || blob.size >= file.size) return file;

  const name = file.name.replace(/\.[^.]+$/, "") || "article-image";
  return new File([blob], `${name}.jpg`, {
    type: "image/jpeg",
    lastModified: file.lastModified,
  });
}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new window.Image();

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image failed to load."));
    };
    image.src = url;
  });
}
