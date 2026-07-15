import Link from "next/link";

import { AdminShell } from "@/components/admin/knowledge/AdminShell";
import { StatusBadge } from "@/components/admin/knowledge/StatusBadge";
import {
  getAdminAccessories,
  getAdminArticles,
  getAdminFAQ,
  getAdminSpareParts,
  getAdminServiceProviders,
  getCategories,
} from "@/lib/supabase/knowledge";
import type { ArticleStatus } from "@/types/knowledge";

export default async function KnowledgeAdminPage() {
  const [articles, faq, accessories, spareParts, serviceProviders, categories] = await Promise.all([
    getAdminArticles(),
    getAdminFAQ(),
    getAdminAccessories(),
    getAdminSpareParts(),
    getAdminServiceProviders(),
    getCategories(),
  ]);

  const allStatuses = [...articles, ...faq, ...accessories, ...spareParts, ...serviceProviders].map((item) => item.status);
  const counts = countStatuses(allStatuses);

  return (
    <AdminShell
      title="Админка базы знаний"
      description="Управление русской базой знаний BYD YUAN UP для Telegram Mini App."
    >
      <section className="grid gap-4 md:grid-cols-7">
        <Metric label="Статьи" value={articles.length} href="/admin/knowledge/articles" />
        <Metric label="Вопросы" value={faq.length} href="/admin/knowledge/faq" />
        <Metric label="Аксессуары" value={accessories.length} href="/admin/knowledge/accessories" />
        <Metric label="Запчасти" value={spareParts.length} href="/admin/knowledge/spare-parts" />
        <Metric label="Сервис" value={serviceProviders.length} href="/admin/knowledge/service-providers" />
        <Metric label="Разделы" value={categories.length} href="/admin/knowledge/categories" />
        <Metric label="Опубликовано" value={counts.published} href="/telegram" />
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {(["draft", "published", "archived"] as ArticleStatus[]).map((status) => (
          <div key={status} className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <StatusBadge status={status} />
              <span className="font-heading text-3xl font-bold">{counts[status]}</span>
            </div>
          </div>
        ))}
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="font-heading text-xl font-bold">Быстрые действия</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link className="min-h-10 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground" href="/admin/knowledge/articles/new">
            Новая статья
          </Link>
          <Link className="min-h-10 rounded-lg border border-border px-4 py-2 text-sm font-semibold" href="/admin/knowledge/faq/new">
            Новый вопрос
          </Link>
          <Link className="min-h-10 rounded-lg border border-border px-4 py-2 text-sm font-semibold" href="/admin/knowledge/accessories/new">
            Новый аксессуар
          </Link>
          <Link className="min-h-10 rounded-lg border border-border px-4 py-2 text-sm font-semibold" href="/admin/knowledge/spare-parts/new">
            Новая запчасть
          </Link>
          <Link className="min-h-10 rounded-lg border border-border px-4 py-2 text-sm font-semibold" href="/admin/knowledge/service-providers/new">
            Новый сервис
          </Link>
          <Link className="min-h-10 rounded-lg border border-[var(--voltflow-cyan)]/50 px-4 py-2 text-sm font-semibold text-[var(--voltflow-cyan)]" href="/admin/knowledge/marketplace">
            Объявления Telegram
          </Link>
        </div>
      </section>
    </AdminShell>
  );
}

function Metric({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <Link href={href} className="rounded-lg border border-border bg-card p-4 transition hover:border-[var(--voltflow-cyan)]/60">
      <p className="text-sm font-semibold text-muted-foreground">{label}</p>
      <p className="mt-2 font-heading text-3xl font-bold">{value}</p>
    </Link>
  );
}

function countStatuses(statuses: ArticleStatus[]) {
  return statuses.reduce(
    (counts, status) => {
      counts[status] += 1;
      return counts;
    },
    { draft: 0, published: 0, archived: 0 } satisfies Record<ArticleStatus, number>,
  );
}
