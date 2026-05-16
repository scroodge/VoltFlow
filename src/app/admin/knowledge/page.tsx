import Link from "next/link";

import { AdminShell } from "@/components/admin/knowledge/AdminShell";
import { StatusBadge } from "@/components/admin/knowledge/StatusBadge";
import {
  getAdminAccessories,
  getAdminArticles,
  getAdminFAQ,
  getCategories,
} from "@/lib/supabase/knowledge";
import type { ArticleStatus } from "@/types/knowledge";

export default async function KnowledgeAdminPage() {
  const [articles, faq, accessories, categories] = await Promise.all([
    getAdminArticles(),
    getAdminFAQ(),
    getAdminAccessories(),
    getCategories(),
  ]);

  const allStatuses = [...articles, ...faq, ...accessories].map((item) => item.status);
  const counts = countStatuses(allStatuses);

  return (
    <AdminShell
      title="Knowledge Admin"
      description="Manage BYD YUAN UP knowledge content used by the Telegram Mini App."
    >
      <section className="grid gap-4 md:grid-cols-5">
        <Metric label="Articles" value={articles.length} href="/admin/knowledge/articles" />
        <Metric label="FAQ" value={faq.length} href="/admin/knowledge/faq" />
        <Metric label="Accessories" value={accessories.length} href="/admin/knowledge/accessories" />
        <Metric label="Categories" value={categories.length} href="/admin/knowledge/categories" />
        <Metric label="Published" value={counts.published} href="/telegram" />
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
        <h2 className="font-heading text-xl font-bold">Quick actions</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link className="min-h-10 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground" href="/admin/knowledge/articles/new">
            New article
          </Link>
          <Link className="min-h-10 rounded-lg border border-border px-4 py-2 text-sm font-semibold" href="/admin/knowledge/faq/new">
            New FAQ
          </Link>
          <Link className="min-h-10 rounded-lg border border-border px-4 py-2 text-sm font-semibold" href="/admin/knowledge/accessories/new">
            New accessory
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
