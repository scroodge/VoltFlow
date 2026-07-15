import Link from "next/link";

import {
  updateCommunityListingAction,
  updateCommunityListingStatusAction,
} from "@/actions/community-listings-admin";
import { AdminShell } from "@/components/admin/knowledge/AdminShell";
import { getAdminCommunityListings, type CommunityListingStatus } from "@/lib/supabase/community-listings";

const statusLabels: Record<CommunityListingStatus, string> = {
  draft: "Черновик",
  published: "Опубликовано",
  sold: "Продано",
  expired: "Истекло",
  removed: "Удалено",
};

const statusStyles: Record<CommunityListingStatus, string> = {
  draft: "border-amber-300/30 bg-amber-300/10 text-amber-100",
  published: "border-emerald-300/30 bg-emerald-300/10 text-emerald-100",
  sold: "border-sky-300/30 bg-sky-300/10 text-sky-100",
  expired: "border-slate-300/30 bg-slate-300/10 text-slate-200",
  removed: "border-red-300/30 bg-red-300/10 text-red-100",
};

const itemTypeLabels = {
  accessory: "Аксессуар",
  spare_part: "Запчасть",
  service: "Сервис",
  car: "Автомобиль",
  other: "Другое",
} as const;

export default async function MarketplaceAdminPage() {
  const listings = await getAdminCommunityListings();
  const drafts = listings.filter((listing) => listing.status === "draft").length;

  return (
    <AdminShell
      title="Объявления"
      description="Модерация сообщений из Telegram. Только опубликованные объявления видны пользователям."
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Всего: {listings.length} · На модерации: {drafts}
        </p>
        <Link href="/telegram?tab=buy" className="text-sm font-semibold text-[var(--voltflow-cyan)] hover:underline">
          Открыть каталог
        </Link>
      </div>

      {listings.length === 0 ? (
        <section className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
          <h2 className="font-heading text-xl font-bold">Пока нет объявлений</h2>
          <p className="mt-2 text-sm text-muted-foreground">Новые сообщения из Telegram появятся здесь после проверки.</p>
        </section>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {listings.map((listing) => (
            <article key={listing.id} className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${statusStyles[listing.status]}`}>
                    {statusLabels[listing.status]}
                  </span>
                  <p className="mt-3 text-xs font-bold uppercase tracking-[0.16em] text-[var(--voltflow-cyan)]">
                    {listing.listing_type === "sell" ? "Продам" : listing.listing_type === "wanted" ? "Куплю" : "Сервис"}
                  </p>
                  <h2 className="mt-1 font-heading text-xl font-bold">{listing.title}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {itemTypeLabels[listing.item_type]}{listing.city ? ` · ${listing.city}` : ""}
                    {listing.price != null ? ` · ${listing.price} ${listing.currency ?? ""}` : ""}
                  </p>
                </div>
                {listing.contact_link ? (
                  <Link href={listing.contact_link} target="_blank" className="text-sm font-semibold text-[var(--voltflow-cyan)] hover:underline">
                    Источник ↗
                  </Link>
                ) : null}
              </div>

              <form action={updateCommunityListingAction} className="mt-5 space-y-3">
                <input type="hidden" name="id" value={listing.id} />
                <label className="block text-sm font-semibold">
                  Заголовок
                  <input name="title" defaultValue={listing.title} className="mt-1.5 min-h-10 w-full rounded-lg border border-border bg-background px-3 text-sm" />
                </label>
                <label className="block text-sm font-semibold">
                  Текст
                  <textarea name="description" defaultValue={listing.description} rows={4} className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm leading-6" />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-sm font-semibold">Тип
                    <select name="item_type" defaultValue={listing.item_type} className="mt-1.5 min-h-10 w-full rounded-lg border border-border bg-background px-3 text-sm">
                      {Object.entries(itemTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </label>
                  <label className="text-sm font-semibold">Город
                    <input name="city" defaultValue={listing.city ?? ""} className="mt-1.5 min-h-10 w-full rounded-lg border border-border bg-background px-3 text-sm" />
                  </label>
                  <label className="text-sm font-semibold">Поколение
                    <input name="generation" defaultValue={listing.generation ?? ""} className="mt-1.5 min-h-10 w-full rounded-lg border border-border bg-background px-3 text-sm" />
                  </label>
                  <label className="text-sm font-semibold">Цена
                    <input name="price" type="number" min="0" step="0.01" defaultValue={listing.price ?? ""} className="mt-1.5 min-h-10 w-full rounded-lg border border-border bg-background px-3 text-sm" />
                  </label>
                </div>
                <label className="block text-sm font-semibold">Валюта
                  <input name="currency" defaultValue={listing.currency ?? ""} className="mt-1.5 min-h-10 w-full rounded-lg border border-border bg-background px-3 text-sm" />
                </label>
                <button type="submit" className="min-h-10 rounded-lg border border-border px-4 text-sm font-bold hover:border-[var(--voltflow-cyan)]">
                  Сохранить изменения
                </button>
              </form>

              <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
                <StatusAction id={listing.id} status="published" label="Опубликовать" primary={listing.status !== "published"} />
                <StatusAction id={listing.id} status="sold" label="Продано" />
                <StatusAction id={listing.id} status="removed" label="Удалить" danger />
              </div>
            </article>
          ))}
        </div>
      )}
    </AdminShell>
  );
}

function StatusAction({ id, status, label, primary = false, danger = false }: { id: string; status: CommunityListingStatus; label: string; primary?: boolean; danger?: boolean }) {
  return (
    <form action={updateCommunityListingStatusAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <button type="submit" className={`min-h-10 rounded-lg border px-3 text-sm font-bold ${primary ? "border-primary bg-primary text-primary-foreground" : danger ? "border-red-400/50 text-red-200" : "border-border text-muted-foreground"}`}>
        {label}
      </button>
    </form>
  );
}
