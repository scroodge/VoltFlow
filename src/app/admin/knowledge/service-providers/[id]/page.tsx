import { notFound } from "next/navigation";

import { updateServiceProviderAction } from "@/actions/knowledge-admin";
import { AdminShell } from "@/components/admin/knowledge/AdminShell";
import { ServiceProviderForm } from "@/components/admin/knowledge/ServiceProviderForm";
import { getAdminServiceProvider } from "@/lib/supabase/knowledge";

export default async function EditServiceProviderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = await getAdminServiceProvider(id);
  if (!item) notFound();
  return <AdminShell title="Редактировать сервис"><ServiceProviderForm item={item} action={updateServiceProviderAction.bind(null, id)} /></AdminShell>;
}
