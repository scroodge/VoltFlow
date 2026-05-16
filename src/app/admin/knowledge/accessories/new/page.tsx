import { createAccessoryAction } from "@/actions/knowledge-admin";
import { AdminShell } from "@/components/admin/knowledge/AdminShell";
import { AccessoryForm } from "@/components/admin/knowledge/AccessoryForm";
import { getCategories } from "@/lib/supabase/knowledge";

export default async function NewAccessoryPage() {
  const categories = await getCategories();

  return (
    <AdminShell title="New Accessory">
      <AccessoryForm categories={categories} action={createAccessoryAction} />
    </AdminShell>
  );
}
