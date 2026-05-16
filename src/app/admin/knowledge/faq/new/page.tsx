import { createFAQAction } from "@/actions/knowledge-admin";
import { AdminShell } from "@/components/admin/knowledge/AdminShell";
import { FAQForm } from "@/components/admin/knowledge/FAQForm";
import { getCategories } from "@/lib/supabase/knowledge";

export default async function NewFAQPage() {
  const categories = await getCategories();

  return (
    <AdminShell title="New FAQ">
      <FAQForm categories={categories} action={createFAQAction} />
    </AdminShell>
  );
}
