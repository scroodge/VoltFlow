import { notFound } from "next/navigation";

import { updateAccessoryAction } from "@/actions/knowledge-admin";
import { AdminShell } from "@/components/admin/knowledge/AdminShell";
import { AccessoryForm } from "@/components/admin/knowledge/AccessoryForm";
import { getAdminAccessory, getCategories } from "@/lib/supabase/knowledge";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditAccessoryPage({ params }: PageProps) {
  const { id } = await params;
  const [item, categories] = await Promise.all([getAdminAccessory(id), getCategories()]);
  if (!item) notFound();

  return (
    <AdminShell title="Edit Accessory">
      <AccessoryForm item={item} categories={categories} action={updateAccessoryAction.bind(null, id)} />
    </AdminShell>
  );
}
