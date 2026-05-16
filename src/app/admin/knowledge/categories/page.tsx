import { Trash2 } from "lucide-react";

import { deleteCategoryAction, upsertCategoryAction } from "@/actions/knowledge-admin";
import { AdminShell } from "@/components/admin/knowledge/AdminShell";
import { CategoryForm } from "@/components/admin/knowledge/CategoryForm";
import { getCategories } from "@/lib/supabase/knowledge";

export default async function CategoriesPage() {
  const categories = await getCategories();

  return (
    <AdminShell title="Categories" description="Categories are public-readable and used by articles, FAQ, and accessories.">
      <section className="grid gap-4 lg:grid-cols-[24rem_1fr]">
        <div>
          <h2 className="mb-3 font-heading text-xl font-bold">New category</h2>
          <CategoryForm action={upsertCategoryAction} />
        </div>
        <div className="space-y-3">
          {categories.map((category) => (
            <article key={category.id} className="rounded-lg border border-border bg-card p-4">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div className="min-w-0 flex-1">
                  <CategoryForm category={category} action={upsertCategoryAction} />
                </div>
                <form action={deleteCategoryAction}>
                  <input type="hidden" name="id" value={category.id} />
                  <button className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 text-sm font-semibold text-destructive">
                    <Trash2 className="size-4" aria-hidden />
                    Delete
                  </button>
                </form>
              </div>
            </article>
          ))}
        </div>
      </section>
    </AdminShell>
  );
}
