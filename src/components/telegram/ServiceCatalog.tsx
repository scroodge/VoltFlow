"use client";

import { ExternalLink, MapPin, ShieldCheck } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { SearchBox } from "@/components/telegram/SearchBox";
import { SemanticSearchResults } from "@/components/telegram/SemanticSearchResults";
import { useSemanticKnowledgeSearch } from "@/hooks/use-semantic-knowledge-search";
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
  const search = useSemanticKnowledgeSearch({
    generation,
    limit: 8,
    sourceTypes: ["service_provider"],
  });

  return (
    <section className="space-y-4" aria-labelledby="service-title">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--voltflow-cyan)]">Сервис</p>
        <h2 id="service-title" className="mt-1 font-heading text-2xl font-bold">Проверенные сервисы и услуги</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">Контакты и предложения для обслуживания BYD YUAN UP. Запись и оплата проходят на стороне сервиса.</p>
      </div>
      <SearchBox value={search.query} onChange={search.search} placeholder="Искать сервисы и услуги" debounceMs={350} />
      {search.trimmedQuery ? (
        <SemanticSearchResults
          error={search.error}
          isLoading={search.isSearching}
          query={search.trimmedQuery}
          results={search.results}
          title="Найденные сервисы"
        />
      ) : visible.length ? (
        <div className="space-y-3">{visible.map((provider) => <ServiceCard key={provider.id} provider={provider} />)}</div>
      ) : (
        <div className="voltflow-card p-4 text-sm leading-6 text-muted-foreground">Каталог сервисов для выбранного поколения пока пуст. Сервисы добавляются через админку базы знаний.</div>
      )}
    </section>
  );
}

function ServiceCard({ provider }: { provider: ServiceProviderItem }) {
  return (
    <Link href={`/telegram/service/${provider.id}`} className="voltflow-card block overflow-hidden p-4 transition hover:border-[var(--voltflow-cyan)]/60 focus-visible:ring-3 focus-visible:ring-[var(--voltflow-cyan)]/30">
      {provider.image_url ? <Image src={provider.image_url} alt={provider.image_alt ?? provider.name} width={640} height={360} unoptimized className="mb-4 aspect-[16/9] w-full rounded-lg border border-border object-cover" /> : null}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--voltflow-green)]">{providerLabels[provider.provider_type]}</p>
          <h3 className="mt-1 font-heading text-lg font-bold">{provider.name}</h3>
        </div>
        {provider.verified_at ? <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--voltflow-green)]/35 bg-[var(--voltflow-green)]/10 px-2.5 py-1 text-xs font-bold text-[var(--voltflow-green)]"><ShieldCheck className="size-3.5" aria-hidden />Проверен</span> : null}
      </div>
      {provider.city || provider.service_area ? <p className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-foreground"><MapPin className="size-4 shrink-0 text-[var(--voltflow-cyan)]" aria-hidden />{[provider.city, provider.service_area].filter(Boolean).join(" · ")}</p> : null}
      {provider.description ? <p className="mt-3 text-sm leading-6 text-foreground/80">{provider.description}</p> : null}
      {provider.services.length ? <p className="mt-3 text-sm text-foreground/75">{provider.services.join(" · ")}</p> : null}
      {provider.price_from !== null ? <p className="mt-4 text-sm font-bold text-[var(--voltflow-green)]">Услуги от {provider.price_from} {provider.currency}</p> : null}
      <span className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-[var(--voltflow-cyan)]">Открыть карточку <ExternalLink className="size-4" aria-hidden /></span>
    </Link>
  );
}
