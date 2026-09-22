"use client";

import Image from "next/image";
import Link from "next/link";
import { useActionState } from "react";

import type { AdminFormState } from "@/actions/knowledge-admin";
import { ExternalLinksEditor } from "@/components/admin/knowledge/ExternalLinksEditor";
import { FieldError, inputClass, Panel, textareaClass } from "@/components/admin/knowledge/ArticleForm";
import { TagsInput } from "@/components/admin/knowledge/TagsInput";
import { stateKey, stateList, stateString } from "@/components/admin/knowledge/form-state";
import { carGenerations } from "@/lib/car-generations";
import { telegramGenerationLabels } from "@/lib/telegram/generation";
import type { KnowledgeCategory, SparePartItem } from "@/types/knowledge";

export function SparePartForm({
  item,
  categories,
  action,
}: {
  item?: SparePartItem;
  categories: KnowledgeCategory[];
  action: (state: AdminFormState, formData: FormData) => Promise<AdminFormState>;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const selectedGenerations = state.values
    ? stateList(state, "model_generations")
    : item?.model_generations ?? carGenerations;

  return (
    <form key={stateKey(state)} action={formAction} className="max-w-4xl">
      <Panel>
        <FieldError message={state.message} />
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1.5 text-sm font-semibold">
            <span>Название запчасти</span>
            <input name="title" defaultValue={stateString(state, "title", item?.title ?? "")} className={inputClass} />
            <FieldError message={state.errors?.title} />
          </label>
          <label className="space-y-1.5 text-sm font-semibold">
            <span>Раздел</span>
            <select name="category_id" defaultValue={stateString(state, "category_id", item?.category_id ?? "")} className={inputClass}>
              <option value="">Выберите раздел</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>{category.title}</option>
              ))}
            </select>
            <FieldError message={state.errors?.category_id} />
          </label>
        </div>

        <label className="space-y-1.5 text-sm font-semibold">
          <span>Описание</span>
          <textarea name="description" defaultValue={stateString(state, "description", item?.description ?? "")} className={textareaClass} />
          <FieldError message={state.errors?.description} />
        </label>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1.5 text-sm font-semibold">
            <span>Номер детали</span>
            <input name="part_number" defaultValue={stateString(state, "part_number", item?.part_number ?? "")} className={inputClass} />
          </label>
          <label className="space-y-1.5 text-sm font-semibold">
            <span>Совместимость</span>
            <input name="compatibility" defaultValue={stateString(state, "compatibility", item?.compatibility ?? "")} className={inputClass} />
          </label>
        </div>

        <ExternalLinksEditor
          defaultValue={
            state.values
              ? stateList(state, "external_link_url").map((url, index) => ({
                  url,
                  label: stateList(state, "external_link_label")[index] ?? "",
                }))
              : item?.external_links
          }
        />

        <div className="space-y-3">
          <label className="space-y-1.5 text-sm font-semibold">
            <span>Фото ракурсов</span>
            <input
              name="image_files"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-bold file:text-primary-foreground"
            />
            <span className="text-xs font-normal text-muted-foreground">
              Первое изображение будет обложкой карточки. Новые фото добавляются к существующим.
            </span>
          </label>
          {item?.images.length ? (
            <div className="grid gap-3 md:grid-cols-3">
              {item.images.map((image, index) => (
                <div key={`${image.url}-${index}`} className="rounded-lg border border-border bg-white/[0.03] p-2">
                  <Image
                    src={image.url}
                    alt={image.alt || item.title}
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

        <TagsInput name="search_keywords" label="Поисковые фразы" defaultValue={stateString(state, "search_keywords", item?.search_keywords.join(", ") ?? "")} />

        <fieldset className="space-y-2 text-sm font-semibold">
          <legend>Поколения Yuan Up</legend>
          <div className="space-y-2">
            {carGenerations.map((generation) => (
              <label key={generation} className="flex items-center gap-2 font-normal">
                <input
                  type="checkbox"
                  name="model_generations"
                  value={generation}
                  defaultChecked={selectedGenerations.includes(generation)}
                  className="size-4 rounded border border-input"
                />
                <span>{telegramGenerationLabels[generation]}</span>
              </label>
            ))}
          </div>
          <FieldError message={state.errors?.model_generations} />
        </fieldset>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1.5 text-sm font-semibold">
            <span>Статус</span>
            <select name="status" defaultValue={stateString(state, "status", item?.status ?? "draft")} className={inputClass}>
              <option value="draft">Черновик</option>
              <option value="published">Опубликовано</option>
              <option value="archived">Архив</option>
            </select>
          </label>
          <label className="space-y-1.5 text-sm font-semibold">
            <span>Порядок сортировки</span>
            <input name="sort_order" type="number" defaultValue={stateString(state, "sort_order", String(item?.sort_order ?? 0))} className={inputClass} />
          </label>
        </div>

        <div className="flex flex-wrap gap-2">
          <button disabled={pending} className="min-h-10 rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-60">
            {pending ? "Сохранение..." : "Сохранить"}
          </button>
          <Link href="/admin/knowledge/spare-parts" className="inline-flex min-h-10 items-center rounded-lg border border-border px-4 text-sm font-semibold">
            Отмена
          </Link>
        </div>
      </Panel>
    </form>
  );
}
