"use client";

export default function AppError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  // Server error messages are deliberately opaque in production. Keeping the
  // digest available to React/Next without rendering it avoids exposing it to
  // a visitor while preserving the framework's normal diagnostic path.
  void error;

  return (
    <main className="mobile-page flex min-h-dvh items-center px-5 py-8">
      <section className="voltflow-card w-full p-6 text-center">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--voltflow-cyan)]">
          VoltFlow
        </p>
        <h1 className="mt-3 font-heading text-2xl font-bold">Что-то пошло не так</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Не удалось открыть этот экран. Попробуйте ещё раз.
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
  );
}
