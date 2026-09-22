"use client";

import "./globals.css";

export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  void error;

  return (
    <html lang="ru" className="dark">
      <body className="bg-background font-sans text-foreground antialiased">
        <main className="mobile-page flex min-h-dvh items-center px-5 py-8">
          <section className="voltflow-card w-full p-6 text-center">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--voltflow-cyan)]">
              VoltFlow
            </p>
            <h1 className="mt-3 font-heading text-2xl font-bold">Не удалось открыть приложение</h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Попробуйте повторить загрузку страницы.
            </p>
            <button
              type="button"
              onClick={() => unstable_retry()}
              className="mt-6 min-h-11 rounded-lg bg-primary px-5 text-sm font-bold text-primary-foreground"
            >
              Повторить
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
