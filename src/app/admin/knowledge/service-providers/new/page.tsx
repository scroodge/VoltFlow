import { createServiceProviderAction } from "@/actions/knowledge-admin";
import { AdminShell } from "@/components/admin/knowledge/AdminShell";
import { ServiceProviderForm } from "@/components/admin/knowledge/ServiceProviderForm";

export default function NewServiceProviderPage() {
  return <AdminShell title="Новый сервис"><ServiceProviderForm action={createServiceProviderAction} /></AdminShell>;
}
