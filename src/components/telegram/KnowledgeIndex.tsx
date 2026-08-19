import Link from "next/link";

import type { TelegramKnowledgeData } from "@/types/knowledge";

/**
 * Server-rendered link index for the knowledge base.
 *
 * Deliberately a plain server component with real `<a href>` elements, mounted
 * OUTSIDE any `<Suspense>` boundary. Two problems it solves:
 *
 * 1. `CategoryFilter` renders categories as `<button>`, so the served HTML of
 *    /telegram contained 4 article URLs and ZERO category URLs. Every category,
 *    accessory, spare-part and service page was orphaned — reachable only by
 *    client-side state, and with no sitemap to find them either.
 * 2. `TelegramShell` and `TelegramCategoryView` call `useSearchParams()` inside
 *    `<Suspense fallback={null}>`. Under static rendering Next prerenders that
 *    fallback and defers the subtree to the client, so the page would ship as
 *    an empty shell. This index is what keeps real content in the static HTML,
 *    and must land BEFORE `revalidate` is enabled on these routes.
 *
 * It is a genuine, visible "all sections / all articles" footer index, not a
 * hidden link farm — never give this `display: none`.
 */
export function KnowledgeIndex({ data }: { data: TelegramKnowledgeData }) {
  const articlesByCategory = data.categories
    .map((category) => ({
      category,
      articles: data.articles.filter(
        (article) => article.categorySlug === category.slug,
      ),
    }))
    .filter((group) => group.articles.length);

  return (
    <nav
      aria-label="Все разделы базы знаний"
      className="mt-8 border-t border-border/60 pt-6"
    >
      <h2 className="font-heading text-lg font-bold text-foreground">
        Все разделы базы знаний
      </h2>

      <ul className="mt-4 flex flex-wrap gap-2">
        {data.categories.map((category) => (
          <li key={category.slug}>
            <Link
              href={`/telegram/category/${category.slug}`}
              className="inline-flex min-h-9 items-center rounded-full border border-border bg-white/[0.03] px-3 text-xs font-semibold text-muted-foreground hover:text-foreground"
            >
              {category.title}
            </Link>
          </li>
        ))}
      </ul>

      {articlesByCategory.map(({ category, articles }) => (
        <section key={category.slug} className="mt-6">
          <h3 className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--voltflow-cyan)]">
            {category.title}
          </h3>
          <ul className="mt-2 space-y-1">
            {articles.map((article) => (
              <li key={article.slug}>
                <Link
                  href={`/telegram/article/${article.slug}`}
                  className="text-sm leading-6 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  {article.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {data.accessories.length ? (
        <section className="mt-6">
          <h3 className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--voltflow-cyan)]">
            Аксессуары
          </h3>
          <ul className="mt-2 space-y-1">
            {data.accessories.map((item) => (
              <li key={item.id}>
                <Link
                  href={`/telegram/accessory/${item.id}`}
                  className="text-sm leading-6 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  {item.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data.spareParts.length ? (
        <section className="mt-6">
          <h3 className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--voltflow-cyan)]">
            Запчасти
          </h3>
          <ul className="mt-2 space-y-1">
            {data.spareParts.map((item) => (
              <li key={item.id}>
                <Link
                  href={`/telegram/spare-part/${item.id}`}
                  className="text-sm leading-6 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  {item.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data.serviceProviders.length ? (
        <section className="mt-6">
          <h3 className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--voltflow-cyan)]">
            Сервисы
          </h3>
          <ul className="mt-2 space-y-1">
            {data.serviceProviders.map((item) => (
              <li key={item.id}>
                <Link
                  href={`/telegram/service/${item.id}`}
                  className="text-sm leading-6 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  {item.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </nav>
  );
}
