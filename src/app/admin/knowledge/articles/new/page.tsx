import { createArticleAction } from "@/actions/knowledge-admin";
import { AdminShell } from "@/components/admin/knowledge/AdminShell";
import { ArticleForm } from "@/components/admin/knowledge/ArticleForm";
import { getAdminArticles, getCategories } from "@/lib/supabase/knowledge";

export default async function NewArticlePage() {
  const [categories, articles] = await Promise.all([getCategories(), getAdminArticles()]);

  return (
    <AdminShell title="New Article">
      <ArticleForm categories={categories} articles={articles} action={createArticleAction} />
    </AdminShell>
  );
}
