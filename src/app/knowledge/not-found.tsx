import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Страница не найдена",
  robots: { index: false, follow: false },
};

/**
 * Segment-scoped 404 for the knowledge base.
 *
 * The article and category routes used to render this copy inline with HTTP
 * 200, which is a soft 404: crawlers treat every stale or mistyped slug as a
 * real, thin, near-duplicate page. They now call `notFound()`, which renders
 * this component with a genuine 404 status.
 */
export default function KnowledgeNotFound() {
  return (
    <main className="relative isolate min-h-dvh overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_-8%,rgba(0,209,255,0.24),transparent_26rem),radial-gradient(circle_at_8%_18%,rgba(0,230,118,0.14),transparent_20rem),linear-gradient(180deg,rgba(18,21,28,0)_0%,#12151C_78%)]" />
      <div className="mobile-page relative min-h-dvh px-4 pb-[calc(env(safe-area-inset-bottom)+2rem)] pt-[calc(env(safe-area-inset-top)+1rem)]">
        <section className="voltflow-card p-5">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--voltflow-cyan)]">
            Страница не найдена
          </p>
          <h1 className="mt-2 font-heading text-2xl font-bold">
            Этого материала нет в базе знаний
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Ссылка может быть устаревшей, либо материал еще готовится к публикации.
          </p>
          <Link
            href="/knowledge"
            className="mt-5 inline-flex min-h-11 items-center rounded-lg border border-border bg-white/[0.04] px-4 text-sm font-semibold text-[var(--voltflow-cyan)]"
          >
            Вернуться в базу знаний
          </Link>
        </section>
      </div>
    </main>
  );
}
