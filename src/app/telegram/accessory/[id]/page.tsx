import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft } from "lucide-react";

import { staticTelegramKnowledgeData } from "@/lib/telegram/knowledge";
import { getTelegramKnowledgeDataWithFallback } from "@/lib/supabase/knowledge";
import { ExternalLinksShare } from "@/components/telegram/ExternalLinksShare";

type PageProps = { params: Promise<{ id: string }> };

async function getAccessory(id: string) {
  const data = await getTelegramKnowledgeDataWithFallback(staticTelegramKnowledgeData);
  return data.accessories.find((item) => item.id === id) ?? null;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const item = await getAccessory((await params).id);
  return item ? { title: `${item.title} — VoltFlow`, description: item.whyUseful } : { title: "Аксессуар — VoltFlow" };
}

export default async function AccessoryPage({ params }: PageProps) {
  const item = await getAccessory((await params).id);
  if (!item) notFound();

  const links = item.externalLinks?.length
    ? item.externalLinks
    : item.externalUrl
      ? [{ label: "Открыть ссылку", url: item.externalUrl }]
      : [];

  return (
    <main className="min-h-dvh bg-background px-3 py-4 text-foreground sm:px-4 sm:py-6">
      <div className="mx-auto max-w-[680px] space-y-5">
        <Link href="/telegram?tab=buy" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border bg-white/[0.04] px-4 text-sm font-semibold text-muted-foreground transition hover:text-foreground"><ArrowLeft className="size-4" aria-hidden />Назад в каталог</Link>
        <article className="voltflow-card p-5">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--voltflow-cyan)]">Аксессуар</p>
          <h1 className="mt-2 font-heading text-3xl font-bold leading-tight">{item.title}</h1>
          {item.imageUrl ? <Image src={item.imageUrl} alt={item.imageAlt || item.title} width={640} height={360} unoptimized className="mt-5 aspect-[16/9] w-full rounded-lg border border-border object-cover" /> : null}
          <p className="mt-5 text-base leading-7 text-foreground/80">{item.useCase}</p>
          <p className="mt-3 text-base leading-7 text-foreground">{item.whyUseful}</p>
          <h2 className="mt-6 font-heading text-xl font-bold">Проверить перед покупкой</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-foreground/80">{item.whatToCheckBeforeBuying.map((check) => <li key={check}>{check}</li>)}</ul>
          {item.riskNotes?.length ? <div className="mt-5 space-y-2">{item.riskNotes.map((note) => <p key={note} className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-sm leading-6 text-amber-100">{note}</p>)}</div> : null}
          <ExternalLinksShare links={links} title={item.title} />
        </article>
      </div>
    </main>
  );
}
