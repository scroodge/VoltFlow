"use client";

import { ExternalLink, MapPin, ShieldCheck, Wrench } from "lucide-react";
import Image from "next/image";

import type { CarGeneration } from "@/lib/car-generations";
import type { ServiceProviderItem } from "@/types/knowledge";

const providerLabels: Record<ServiceProviderItem["provider_type"], string> = {
  service_center: "Сервисный центр",
  mobile_service: "Выездной сервис",
  detailer: "Детейлинг",
  parts_and_service: "Запчасти и ремонт",
  other: "Автосервис",
};

export function ServiceCatalog({ providers = [], generation }: { providers?: ServiceProviderItem[]; generation: CarGeneration }) {
  const visible = providers.filter((provider) => provider.model_generations.includes(generation));

  return (
    <section className="space-y-4" aria-labelledby="service-title">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--voltflow-cyan)]">Сервис</p>
        <h2 id="service-title" className="mt-1 font-heading text-2xl font-bold">Проверенные сервисы и услуги</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">Контакты и предложения для обслуживания BYD YUAN UP. Запись и оплата проходят на стороне сервиса.</p>
      </div>
      {visible.length ? (
        <div className="space-y-3">{visible.map((provider) => <ServiceCard key={provider.id} provider={provider} />)}</div>
      ) : (
        <div className="voltflow-card p-4 text-sm leading-6 text-muted-foreground">Каталог сервисов для выбранного поколения пока пуст. Сервисы добавляются через админку базы знаний.</div>
      )}
    </section>
  );
}

function ServiceCard({ provider }: { provider: ServiceProviderItem }) {
  return (
    <article className="voltflow-card overflow-hidden p-4">
      {provider.image_url ? <Image src={provider.image_url} alt={provider.image_alt ?? provider.name} width={640} height={360} unoptimized className="mb-4 aspect-[16/9] w-full rounded-lg border border-border object-cover" /> : null}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--voltflow-green)]">{providerLabels[provider.provider_type]}</p>
          <h3 className="mt-1 font-heading text-lg font-bold">{provider.name}</h3>
        </div>
        {provider.verified_at ? <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--voltflow-green)]/35 bg-[var(--voltflow-green)]/10 px-2.5 py-1 text-xs font-bold text-[var(--voltflow-green)]"><ShieldCheck className="size-3.5" aria-hidden />Проверен</span> : null}
      </div>
      {provider.city || provider.service_area ? <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground"><MapPin className="size-4 shrink-0" aria-hidden />{[provider.city, provider.service_area].filter(Boolean).join(" · ")}</p> : null}
      {provider.description ? <p className="mt-3 text-sm leading-6 text-muted-foreground">{provider.description}</p> : null}
      <div className="mt-4 flex flex-wrap gap-2">{provider.services.map((service) => <span key={service} className="inline-flex items-center gap-1 rounded-full border border-border bg-white/[0.04] px-2.5 py-1 text-xs font-semibold text-muted-foreground"><Wrench className="size-3" aria-hidden />{service}</span>)}</div>
      {provider.price_from !== null ? <p className="mt-4 text-sm font-bold">Услуги от {provider.price_from} {provider.currency}</p> : null}
      {provider.external_links.length ? <div className="mt-4 flex flex-wrap gap-2">{provider.external_links.map((link) => <a key={`${link.label}-${link.url}`} href={link.url} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border bg-white/[0.04] px-4 text-sm font-semibold text-[var(--voltflow-cyan)] transition hover:bg-white/[0.07]">{link.label}<ExternalLink className="size-4" aria-hidden /></a>)}</div> : null}
    </article>
  );
}
