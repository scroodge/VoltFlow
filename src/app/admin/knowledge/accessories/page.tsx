import { Edit, Plus } from "lucide-react";
import Link from "next/link";

import { deleteAccessoryAction } from "@/actions/knowledge-admin";
import { AdminShell } from "@/components/admin/knowledge/AdminShell";
import { DeleteButton } from "@/components/admin/knowledge/DeleteButton";
import { StatusBadge } from "@/components/admin/knowledge/StatusBadge";
import { getAdminAccessories, getCategories } from "@/lib/supabase/knowledge";

type PageProps = {
  searchParams: Promise<{ status?: string; category?: string; q?: string }>;
};

export default async function AccessoriesPage({ searchParams }: PageProps) {
  const filters = await searchParams;
  const [items, categories] = await Promise.all([getAdminAccessories(), getCategories()]);
  const filtered = items.filter((item) => {
    const q = filters.q?.toLowerCase().trim();
    return (
      (!filters.status || item.status === filters.status) &&
      (!filters.category || item.category_id === filters.category) &&
      (!q || [item.title, item.use_case ?? "", item.why_useful ?? ""].join(" ").toLowerCase().includes(q))
    );
  });

  return (
    <AdminShell title="Accessories">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <FilterForm categories={categories} filters={filters} />
        <Link href="/admin/knowledge/accessories/new" className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground">
          <Plus className="size-4" aria-hidden />
          New accessory
        </Link>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {filtered.map((item) => (
          <article key={item.id} className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={item.status} />
                  <span className="text-xs text-muted-foreground">{item.priority}</span>
                </div>
                <h2 className="mt-2 font-heading text-lg font-bold">{item.title}</h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">{item.why_useful}</p>
              </div>
              <div className="flex gap-2">
                <Link href={`/admin/knowledge/accessories/${item.id}`} className="grid size-8 place-items-center rounded-lg border border-border" aria-label="Edit accessory">
                  <Edit className="size-4" aria-hidden />
                </Link>
                <DeleteButton id={item.id} label={item.title} action={deleteAccessoryAction} />
              </div>
            </div>
          </article>
        ))}
      </div>
    </AdminShell>
  );
}

function FilterForm({
  categories,
  filters,
}: {
  categories: Awaited<ReturnType<typeof getCategories>>;
  filters: { status?: string; category?: string; q?: string };
}) {
  return (
    <form className="grid gap-2 md:grid-cols-[10rem_12rem_16rem_auto]">
      <select name="status" defaultValue={filters.status ?? ""} className="min-h-10 rounded-lg border border-input bg-background px-3 text-sm">
        <option value="">All statuses</option>
        <option value="draft">Draft</option>
        <option value="published">Published</option>
        <option value="archived">Archived</option>
      </select>
      <select name="category" defaultValue={filters.category ?? ""} className="min-h-10 rounded-lg border border-input bg-background px-3 text-sm">
        <option value="">All categories</option>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>{category.title}</option>
        ))}
      </select>
      <input name="q" defaultValue={filters.q ?? ""} placeholder="Search" className="min-h-10 rounded-lg border border-input bg-background px-3 text-sm" />
      <button className="min-h-10 rounded-lg border border-border px-4 text-sm font-semibold">Filter</button>
    </form>
  );
}
