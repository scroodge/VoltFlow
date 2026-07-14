import { Edit, Plus } from "lucide-react";
import Link from "next/link";

import { deleteServiceProviderAction } from "@/actions/knowledge-admin";
import { AdminShell } from "@/components/admin/knowledge/AdminShell";
import { DeleteButton } from "@/components/admin/knowledge/DeleteButton";
import { StatusBadge } from "@/components/admin/knowledge/StatusBadge";
import { getAdminServiceProviders } from "@/lib/supabase/knowledge";

export default async function ServiceProvidersPage() {
  const providers = await getAdminServiceProviders();
  return <AdminShell title="Сервис"><div className="flex justify-end"><Link href="/admin/knowledge/service-providers/new" className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground"><Plus className="size-4" aria-hidden />Новый сервис</Link></div><div className="mt-4 grid gap-3 md:grid-cols-2">{providers.map((provider) => <article key={provider.id} className="rounded-lg border border-border bg-card p-4"><div className="flex items-start justify-between gap-3"><div><StatusBadge status={provider.status} /><h2 className="mt-2 font-heading text-lg font-bold">{provider.name}</h2><p className="mt-1 text-sm text-muted-foreground">{provider.city ?? "Без города"} · {provider.services.join(", ")}</p></div><div className="flex gap-2"><Link href={`/admin/knowledge/service-providers/${provider.id}`} className="grid size-8 place-items-center rounded-lg border border-border" aria-label="Редактировать сервис"><Edit className="size-4" aria-hidden /></Link><DeleteButton id={provider.id} label={provider.name} action={deleteServiceProviderAction} /></div></div></article>)}</div></AdminShell>;
}
