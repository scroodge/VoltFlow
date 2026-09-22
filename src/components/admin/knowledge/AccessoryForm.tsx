"use client";

import Link from "next/link";
import Image from "next/image";
import { useActionState } from "react";

import type { AdminFormState } from "@/actions/knowledge-admin";
import { FieldError, inputClass, Panel, textareaClass } from "@/components/admin/knowledge/ArticleForm";
import { ExternalLinksEditor } from "@/components/admin/knowledge/ExternalLinksEditor";
import { TagsInput } from "@/components/admin/knowledge/TagsInput";
import { stateKey, stateList, stateString } from "@/components/admin/knowledge/form-state";
import { carGenerations } from "@/lib/car-generations";
import { telegramGenerationLabels } from "@/lib/telegram/generation";
import type { AccessoryItem, KnowledgeCategory } from "@/types/knowledge";

export function AccessoryForm({
  item,
  categories,
  action,
}: {
  item?: AccessoryItem;
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
            <span>Название</span>
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
          <span>Сценарий использования</span>
          <textarea name="use_case" defaultValue={stateString(state, "use_case", item?.use_case ?? "")} className={textareaClass} />
        </label>
        <label className="space-y-1.5 text-sm font-semibold">
          <span>Чем полезно</span>
          <textarea name="why_useful" defaultValue={stateString(state, "why_useful", item?.why_useful ?? "")} className={textareaClass} />
        </label>
        <label className="space-y-1.5 text-sm font-semibold">
          <span>Что проверить перед покупкой</span>
          <textarea name="what_to_check" defaultValue={stateString(state, "what_to_check", item?.what_to_check.join("\n") ?? "")} className={textareaClass} />
          <span className="text-xs font-normal text-muted-foreground">Один пункт на строку.</span>
        </label>
        <label className="space-y-1.5 text-sm font-semibold">
          <span>Риски и замечания</span>
          <textarea name="risk_notes" defaultValue={stateString(state, "risk_notes", item?.risk_notes.join("\n") ?? "")} className={textareaClass} />
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
                  defaultChecked={selectedGenerations.includes(generation)}
                  className="size-4 rounded border border-input"
                />
                <span>{telegramGenerationLabels[generation]}</span>
              </label>
            ))}
          </div>
          <FieldError message={state.errors?.model_generations} />
        </fieldset>
        <TagsInput name="search_keywords" label="Поисковые фразы" defaultValue={stateString(state, "search_keywords", item?.search_keywords.join(", ") ?? "")} />
        <label className="space-y-1.5 text-sm font-semibold">
          <span>Основная внешняя ссылка</span>
          <input name="external_url" defaultValue={stateString(state, "external_url", item?.external_url ?? "")} className={inputClass} />
          <span className="text-xs font-normal text-muted-foreground">
            Старое одиночное поле. Для нескольких магазинов используйте список ниже.
          </span>
        </label>
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
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1.5 text-sm font-semibold">
            <span>Изображение</span>
            <input
              name="image_file"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-bold file:text-primary-foreground"
            />
            <span className="text-xs font-normal text-muted-foreground">
              Новый файл заменит текущую ссылку на изображение.
            </span>
          </label>
          <label className="space-y-1.5 text-sm font-semibold">
            <span>Описание изображения</span>
            <input name="image_alt" defaultValue={stateString(state, "image_alt", item?.image_alt ?? "")} className={inputClass} />
          </label>
        </div>
        <input type="hidden" name="image_url" value={item?.image_url ?? ""} />
        {item?.image_url ? (
          <div className="rounded-lg border border-border bg-white/[0.03] p-3">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
              Текущее изображение
            </p>
            <Image
              src={item.image_url}
              alt={item.image_alt ?? item.title}
              width={480}
              height={270}
              unoptimized
              className="mt-3 max-h-48 rounded-lg object-cover"
            />
          </div>
        ) : null}
        <div className="grid gap-4 md:grid-cols-3">
          <label className="space-y-1.5 text-sm font-semibold">
            <span>Приоритет</span>
            <select name="priority" defaultValue={stateString(state, "priority", item?.priority ?? "useful")} className={inputClass}>
              <option value="must-have">Обязательно</option>
              <option value="useful">Полезно</option>
              <option value="optional">Опционально</option>
            </select>
          </label>
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
          <Link href="/admin/knowledge/accessories" className="inline-flex min-h-10 items-center rounded-lg border border-border px-4 text-sm font-semibold">
            Отмена
          </Link>
        </div>
      </Panel>
    </form>
  );
}
