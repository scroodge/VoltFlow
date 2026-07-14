"use client";

import Link from "next/link";
import { useActionState } from "react";

import type { AdminFormState } from "@/actions/knowledge-admin";
import { FieldError, inputClass, Panel, textareaClass } from "@/components/admin/knowledge/ArticleForm";
import { ExternalLinksEditor } from "@/components/admin/knowledge/ExternalLinksEditor";
import { stateKey, stateList, stateString } from "@/components/admin/knowledge/form-state";
import { carGenerations } from "@/lib/car-generations";
import { telegramGenerationLabels } from "@/lib/telegram/generation";
import type { ServiceProviderItem } from "@/types/knowledge";

export function ServiceProviderForm({ item, action }: { item?: ServiceProviderItem; action: (state: AdminFormState, formData: FormData) => Promise<AdminFormState> }) {
  const [state, formAction, pending] = useActionState(action, {});
  const generations = state.values ? stateList(state, "model_generations") : item?.model_generations ?? carGenerations;

  return (
    <form key={stateKey(state)} action={formAction} className="max-w-4xl">
      <Panel>
        <FieldError message={state.message} />
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1.5 text-sm font-semibold"><span>Название</span><input name="name" defaultValue={stateString(state, "name", item?.name ?? "")} className={inputClass} /><FieldError message={state.errors?.name} /></label>
          <label className="space-y-1.5 text-sm font-semibold"><span>Тип</span><select name="provider_type" defaultValue={stateString(state, "provider_type", item?.provider_type ?? "service_center")} className={inputClass}><option value="service_center">Сервисный центр</option><option value="mobile_service">Выездной сервис</option><option value="detailer">Детейлинг</option><option value="parts_and_service">Запчасти и ремонт</option><option value="other">Автосервис</option></select></label>
          <label className="space-y-1.5 text-sm font-semibold"><span>Город</span><input name="city" defaultValue={stateString(state, "city", item?.city ?? "")} className={inputClass} /></label>
          <label className="space-y-1.5 text-sm font-semibold"><span>Адрес</span><input name="address" defaultValue={stateString(state, "address", item?.address ?? "")} className={inputClass} /></label>
          <label className="space-y-1.5 text-sm font-semibold"><span>Зона выезда / район</span><input name="service_area" defaultValue={stateString(state, "service_area", item?.service_area ?? "")} className={inputClass} /></label>
        </div>
        <label className="space-y-1.5 text-sm font-semibold"><span>Описание</span><textarea name="description" defaultValue={stateString(state, "description", item?.description ?? "")} className={textareaClass} /></label>
        <label className="space-y-1.5 text-sm font-semibold"><span>Услуги</span><textarea name="services" defaultValue={stateString(state, "services", item?.services.join("\n") ?? "")} className={textareaClass} /><span className="text-xs font-normal text-muted-foreground">Одна услуга на строку.</span><FieldError message={state.errors?.services} /></label>
        <div className="grid gap-4 md:grid-cols-2"><label className="space-y-1.5 text-sm font-semibold"><span>Цена от</span><input name="price_from" type="number" min="0" step="0.01" defaultValue={stateString(state, "price_from", item?.price_from?.toString() ?? "")} className={inputClass} /></label><label className="space-y-1.5 text-sm font-semibold"><span>Валюта</span><input name="currency" defaultValue={stateString(state, "currency", item?.currency ?? "BYN")} className={inputClass} /></label></div>
        <div className="grid gap-4 md:grid-cols-2"><label className="space-y-1.5 text-sm font-semibold"><span>Дата проверки</span><input name="verified_at" type="date" defaultValue={stateString(state, "verified_at", item?.verified_at ?? "")} className={inputClass} /></label><label className="space-y-1.5 text-sm font-semibold"><span>Ссылка на изображение</span><input name="image_url" defaultValue={stateString(state, "image_url", item?.image_url ?? "")} className={inputClass} /></label></div>
        <label className="space-y-1.5 text-sm font-semibold"><span>Описание изображения</span><input name="image_alt" defaultValue={stateString(state, "image_alt", item?.image_alt ?? "")} className={inputClass} /></label>
        <ExternalLinksEditor defaultValue={state.values ? stateList(state, "external_link_url").map((url, index) => ({ url, label: stateList(state, "external_link_label")[index] ?? "" })) : item?.external_links} />
        <fieldset className="space-y-2 text-sm font-semibold"><legend>Поколения Yuan Up</legend>{carGenerations.map((generation) => <label key={generation} className="flex items-center gap-2 font-normal"><input type="checkbox" name="model_generations" value={generation} defaultChecked={generations.includes(generation)} className="size-4 rounded border border-input" /><span>{telegramGenerationLabels[generation]}</span></label>)}<FieldError message={state.errors?.model_generations} /></fieldset>
        <div className="grid gap-4 md:grid-cols-2"><label className="space-y-1.5 text-sm font-semibold"><span>Статус</span><select name="status" defaultValue={stateString(state, "status", item?.status ?? "draft")} className={inputClass}><option value="draft">Черновик</option><option value="published">Опубликовано</option><option value="archived">Архив</option></select></label><label className="space-y-1.5 text-sm font-semibold"><span>Порядок</span><input name="sort_order" type="number" defaultValue={stateString(state, "sort_order", String(item?.sort_order ?? 0))} className={inputClass} /></label></div>
        <div className="flex flex-wrap gap-2"><button disabled={pending} className="min-h-10 rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-60">{pending ? "Сохранение..." : "Сохранить"}</button><Link href="/admin/knowledge/service-providers" className="inline-flex min-h-10 items-center rounded-lg border border-border px-4 text-sm font-semibold">Отмена</Link></div>
      </Panel>
    </form>
  );
}
