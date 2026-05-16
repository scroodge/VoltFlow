import { Edit, ExternalLink, Plus } from "lucide-react";
import Link from "next/link";

import { deleteArticleAction } from "@/actions/knowledge-admin";
import { AdminShell } from "@/components/admin/knowledge/AdminShell";
import { DeleteButton } from "@/components/admin/knowledge/DeleteButton";
import { StatusBadge } from "@/components/admin/knowledge/StatusBadge";
import { getAdminArticles, getCategories } from "@/lib/supabase/knowledge";

type PageProps = {
  searchParams: Promise<{ status?: string; category?: string; q?: string }>;
};

export default async function ArticlesPage({ searchParams }: PageProps) {
  const filters = await searchParams;
  const [articles, categories] = await Promise.all([getAdminArticles(), getCategories()]);
  const filtered = articles.filter((article) => {
    const q = filters.q?.toLowerCase().trim();
    return (
      (!filters.status || article.status === filters.status) &&
      (!filters.category || article.category_id === filters.category) &&
      (!q || [article.title, article.slug, article.summary ?? ""].join(" ").toLowerCase().includes(q))
    );
  });

  return (
    <AdminShell title="Articles" description="Create, edit, publish, and archive knowledge articles.">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <FilterForm categories={categories} filters={filters} />
        <Link href="/admin/knowledge/articles/new" className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground">
          <Plus className="size-4" aria-hidden />
          New article
        </Link>
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-b border-border text-xs uppercase tracking-[0.14em] text-muted-foreground">
            <tr>
              <th className="p-3">Title</th>
              <th className="p-3">Category</th>
              <th className="p-3">Status</th>
              <th className="p-3">Updated</th>
              <th className="p-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((article) => (
              <tr key={article.id} className="border-b border-border/70 last:border-0">
                <td className="p-3">
                  <p className="font-semibold">{article.title}</p>
                  <p className="text-xs text-muted-foreground">{article.slug}</p>
                </td>
                <td className="p-3 text-muted-foreground">{article.category?.title ?? "None"}</td>
                <td className="p-3"><StatusBadge status={article.status} /></td>
                <td className="p-3 text-muted-foreground">{article.updated_at.slice(0, 10)}</td>
                <td className="p-3">
                  <div className="flex justify-end gap-2">
                    {article.status === "published" ? (
                      <Link href={`/telegram/article/${article.slug}`} className="grid size-8 place-items-center rounded-lg border border-border" aria-label="Preview article">
                        <ExternalLink className="size-4" aria-hidden />
                      </Link>
                    ) : null}
                    <Link href={`/admin/knowledge/articles/${article.id}`} className="grid size-8 place-items-center rounded-lg border border-border" aria-label="Edit article">
                      <Edit className="size-4" aria-hidden />
                    </Link>
                    <DeleteButton id={article.id} label={article.title} action={deleteArticleAction} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
