import { notFound } from "next/navigation";

import { updateFAQAction } from "@/actions/knowledge-admin";
import { AdminShell } from "@/components/admin/knowledge/AdminShell";
import { FAQForm } from "@/components/admin/knowledge/FAQForm";
import { getAdminFAQItem, getCategories } from "@/lib/supabase/knowledge";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditFAQPage({ params }: PageProps) {
  const { id } = await params;
  const [item, categories] = await Promise.all([getAdminFAQItem(id), getCategories()]);
  if (!item) notFound();

  return (
    <AdminShell title="Edit FAQ">
      <FAQForm item={item} categories={categories} action={updateFAQAction.bind(null, id)} />
    </AdminShell>
  );
}
