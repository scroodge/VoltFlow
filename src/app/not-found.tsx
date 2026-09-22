import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mobile-page flex min-h-dvh items-center px-5 py-8">
      <section className="voltflow-card w-full p-6 text-center">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--voltflow-cyan)]">
          404
        </p>
        <h1 className="mt-3 font-heading text-2xl font-bold">Страница не найдена</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Возможно, ссылка устарела или была введена с ошибкой.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex min-h-11 items-center rounded-lg bg-primary px-5 text-sm font-bold text-primary-foreground"
        >
          На главную
        </Link>
      </section>
    </main>
  );
}
