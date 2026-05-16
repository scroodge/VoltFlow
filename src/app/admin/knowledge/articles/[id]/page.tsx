import { notFound } from "next/navigation";

import { updateArticleAction } from "@/actions/knowledge-admin";
import { AdminShell } from "@/components/admin/knowledge/AdminShell";
import { ArticleForm } from "@/components/admin/knowledge/ArticleForm";
import { getAdminArticle, getAdminArticles, getCategories } from "@/lib/supabase/knowledge";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditArticlePage({ params }: PageProps) {
  const { id } = await params;
  const [article, categories, articles] = await Promise.all([
    getAdminArticle(id),
    getCategories(),
    getAdminArticles(),
  ]);

  if (!article) notFound();

  return (
    <AdminShell title="Edit Article">
      <ArticleForm
        article={article}
        categories={categories}
        articles={articles}
        action={updateArticleAction.bind(null, id)}
      />
    </AdminShell>
  );
}
