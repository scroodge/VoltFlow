import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, MapPin, ShieldCheck } from "lucide-react";

import { getPublishedServiceProvider } from "@/lib/supabase/knowledge";
import { ServiceMapLink } from "@/components/telegram/ServiceMapLink";
import { ExternalLinksShare } from "@/components/telegram/ExternalLinksShare";

type PageProps = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const provider = await getPublishedServiceProvider(id);
  return provider
    ? { title: `${provider.name} — Сервис VoltFlow`, description: provider.description ?? "Сервис для BYD YUAN UP." }
    : { title: "Сервис VoltFlow" };
}

export default async function ServiceProviderPage({ params }: PageProps) {
  const { id } = await params;
  const provider = await getPublishedServiceProvider(id);
  if (!provider) notFound();

  return (
    <main className="min-h-dvh bg-background px-3 py-4 text-foreground sm:px-4 sm:py-6">
      <div className="mx-auto max-w-[680px] space-y-5">
        <div className="flex items-center justify-between gap-3">
          <Link href="/telegram?tab=buy" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border bg-white/[0.04] px-4 text-sm font-semibold text-muted-foreground transition hover:text-foreground">
            <ArrowLeft className="size-4" aria-hidden /> Назад в каталог
          </Link>
          {provider.verified_at ? <span className="hidden items-center gap-1 rounded-full border border-[var(--voltflow-green)]/35 bg-[var(--voltflow-green)]/10 px-2.5 py-1 text-xs font-bold text-[var(--voltflow-green)] sm:inline-flex"><ShieldCheck className="size-3.5" aria-hidden />Проверен</span> : null}
        </div>
        <article className="voltflow-card p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--voltflow-cyan)]">Сервис</p>
              <h1 className="mt-2 font-heading text-3xl font-bold leading-tight">{provider.name}</h1>
            </div>
            {provider.verified_at ? <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--voltflow-green)]/35 bg-[var(--voltflow-green)]/10 px-2.5 py-1 text-xs font-bold text-[var(--voltflow-green)]"><ShieldCheck className="size-3.5" aria-hidden />Проверен</span> : null}
          </div>
          {provider.address || provider.city || provider.service_area ? <div className="mt-3 space-y-2"><p className="flex items-center gap-1.5 text-sm font-semibold text-foreground"><MapPin className="size-4 shrink-0 text-[var(--voltflow-cyan)]" aria-hidden />{[provider.address, provider.city, provider.service_area].filter(Boolean).join(", ")}</p>{provider.address || provider.city ? <ServiceMapLink address={[provider.address, provider.city, provider.service_area].filter(Boolean).join(", ")} /> : null}</div> : null}
          {provider.description ? <p className="mt-5 text-base leading-7 text-foreground/80">{provider.description}</p> : null}
          {provider.services.length ? <p className="mt-6 text-sm font-semibold text-foreground/80">Услуги: {provider.services.join(", ")}</p> : null}
          {provider.price_from !== null ? <p className="mt-5 text-base font-bold text-[var(--voltflow-green)]">Услуги от {provider.price_from} {provider.currency}</p> : null}
          <ExternalLinksShare links={provider.external_links} title={provider.name} />
        </article>
      </div>
    </main>
  );
}
