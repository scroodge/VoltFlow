import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft } from "lucide-react";

import { staticTelegramKnowledgeData } from "@/lib/telegram/knowledge";
import { getTelegramKnowledgeDataWithFallback } from "@/lib/supabase/knowledge";
import { ExternalLinksShare } from "@/components/telegram/ExternalLinksShare";

type PageProps = { params: Promise<{ id: string }> };

async function getSparePart(id: string) {
  const data = await getTelegramKnowledgeDataWithFallback(staticTelegramKnowledgeData);
  return data.spareParts.find((item) => item.id === id) ?? null;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const item = await getSparePart((await params).id);
  return item ? { title: `${item.title} — VoltFlow`, description: item.description ?? "Запчасть для BYD YUAN UP." } : { title: "Запчасть — VoltFlow" };
}

export default async function SparePartPage({ params }: PageProps) {
  const item = await getSparePart((await params).id);
  if (!item) notFound();

  return (
    <main className="min-h-dvh bg-background px-3 py-4 text-foreground sm:px-4 sm:py-6">
      <div className="mx-auto max-w-[680px] space-y-5">
        <Link href="/telegram?tab=buy" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border bg-white/[0.04] px-4 text-sm font-semibold text-muted-foreground transition hover:text-foreground"><ArrowLeft className="size-4" aria-hidden />Назад в каталог</Link>
        <article className="voltflow-card p-5">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--voltflow-cyan)]">Запчасть</p>
          <h1 className="mt-2 font-heading text-3xl font-bold leading-tight">{item.title}</h1>
          {item.images.length ? <div className="mt-5 grid gap-3 sm:grid-cols-2">{item.images.map((image) => <Image key={image.url} src={image.url} alt={image.alt || item.title} width={800} height={600} unoptimized className="w-full rounded-lg border border-border object-cover" />)}</div> : null}
          {item.description ? <p className="mt-5 text-base leading-7 text-foreground/80">{item.description}</p> : null}
          {item.part_number || item.compatibility ? <div className="mt-5 space-y-2 rounded-lg border border-border bg-white/[0.03] p-3 text-sm leading-6"><p>{item.part_number ? <><span className="font-semibold">Номер:</span> {item.part_number}</> : null}</p><p>{item.compatibility ? <><span className="font-semibold">Совместимость:</span> {item.compatibility}</> : null}</p></div> : null}
          <ExternalLinksShare links={item.external_links} title={item.title} />
        </article>
      </div>
    </main>
  );
}
